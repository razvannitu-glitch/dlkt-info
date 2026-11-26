-- Disposable PostgreSQL candidate. NOT a production migration.
begin;
create role dlkt_billing_reconcile_owner nologin noinherit nobypassrls;
create role dlkt_billing_reconciler nologin noinherit nobypassrls;
grant usage on schema dlkt_info_billing to dlkt_billing_reconcile_owner,dlkt_billing_reconciler;

create table dlkt_info_billing.subscription_reconcile (
  account_id text not null,
  subscription_id text not null,
  generation bigint not null default 1 check (generation > 0),
  fence bigint not null default 0 check (fence >= 0),
  attempt integer not null default 0 check (attempt between 0 and 5),
  state text not null default 'pending' check (state in ('pending','leased','observed','dead')),
  available_at timestamptz not null default clock_timestamp(),
  lease_until timestamptz,
  observed_at timestamptz,
  observed_status text check (observed_status in ('active','trialing','past_due','unpaid','canceled','incomplete','incomplete_expired','paused')),
  -- These observations deliberately cannot become entitlement evidence.
  funds_confirmed boolean generated always as (false) stored,
  risk_state text generated always as ('unknown'::text) stored,
  primary key(account_id,subscription_id),
  foreign key(account_id,subscription_id) references dlkt_info_billing.subscription_bindings(account_id,subscription_id),
  check (
    (state='pending' and attempt<5 and lease_until is null and observed_at is null and observed_status is null)
    or (state='leased' and attempt>=1 and lease_until is not null and observed_at is null and observed_status is null)
    or (state='observed' and attempt>=1 and lease_until is null and observed_at is not null and observed_status is not null)
    or (state='dead' and attempt>=1 and lease_until is null and observed_at is null and observed_status is null)
  )
);
create index reconcile_ready_idx on dlkt_info_billing.subscription_reconcile(account_id,available_at,subscription_id) where state='pending';
create index reconcile_expired_idx on dlkt_info_billing.subscription_reconcile(account_id,lease_until,subscription_id) where state='leased';
alter table dlkt_info_billing.subscription_reconcile enable row level security;
revoke all on dlkt_info_billing.subscription_reconcile from public,anon,authenticated,service_role,dlkt_billing_worker,dlkt_billing_reconciler;
grant select,insert,update on dlkt_info_billing.subscription_reconcile to dlkt_billing_queue_owner;
grant select,update on dlkt_info_billing.subscription_reconcile to dlkt_billing_reconcile_owner;
create policy reconcile_router_read on dlkt_info_billing.subscription_reconcile for select to dlkt_billing_queue_owner using(true);
create policy reconcile_router_insert on dlkt_info_billing.subscription_reconcile for insert to dlkt_billing_queue_owner with check(true);
create policy reconcile_router_update on dlkt_info_billing.subscription_reconcile for update to dlkt_billing_queue_owner using(true) with check(true);
create policy reconcile_executor_read on dlkt_info_billing.subscription_reconcile for select to dlkt_billing_reconcile_owner using(true);
create policy reconcile_executor_update on dlkt_info_billing.subscription_reconcile for update to dlkt_billing_reconcile_owner using(true) with check(true);

grant select on dlkt_info_billing.subscription_bindings,dlkt_info_billing.customer_bindings to dlkt_billing_queue_owner,dlkt_billing_reconcile_owner;
create policy reconcile_binding_read on dlkt_info_billing.subscription_bindings for select to dlkt_billing_queue_owner,dlkt_billing_reconcile_owner using(true);
create policy reconcile_customer_read on dlkt_info_billing.customer_bindings for select to dlkt_billing_queue_owner,dlkt_billing_reconcile_owner using(true);

-- Only directly addressed subscription notices are supported in this increment.
-- An invoice, session, charge or dispute must first be resolved via authenticated
-- Stripe objects; do not accept a caller-supplied mapping to a subscription.
create function dlkt_info_billing.route_subscription_notice(p_account text,p_event text,p_attempt integer)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare v_job dlkt_info_billing.event_jobs%rowtype; v_notice dlkt_info_billing.event_notices%rowtype;
begin
  select j.* into v_job from dlkt_info_billing.event_jobs j
  where j.account_id=p_account and j.event_id=p_event for update;
  if not found or v_job.state<>'leased' or v_job.attempt is distinct from p_attempt
    or v_job.lease_until<=clock_timestamp() then return false; end if;
  select n.* into strict v_notice from dlkt_info_billing.event_notices n where n.account_id=p_account and n.event_id=p_event;
  if v_notice.event_type not like 'customer.subscription.%' then return false; end if;
  if not exists(select 1 from dlkt_info_billing.subscription_bindings s
    join dlkt_info_billing.customer_bindings c on c.account_id=s.account_id and c.customer_id=s.customer_id
    where s.account_id=p_account and s.subscription_id=v_notice.object_id and c.owner_id is not null) then return false; end if;

  insert into dlkt_info_billing.subscription_reconcile as q(account_id,subscription_id) values(p_account,v_notice.object_id)
  on conflict(account_id,subscription_id) do update
    set generation=q.generation+1,attempt=0,state='pending',available_at=clock_timestamp(),
        lease_until=null,observed_at=null,observed_status=null;
  -- Same transaction: the event is routed only if the reconciliation request persists.
  -- If the job expired while waiting on the subscription lock, roll back both changes.
  if not dlkt_info_billing.finish_notice(p_account,p_event,p_attempt,'routed') then
    raise exception using errcode='40001',message='BILLING_ROUTE_LEASE_EXPIRED';
  end if;
  return true;
end;
$$;

-- Remove the old ability to mark an event routed without a durable target.
-- Unsupported event types can retry or dead-letter, not be silently acknowledged.
create function dlkt_info_billing.fail_notice(p_account text,p_event text,p_attempt integer,p_outcome text)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
begin
  if p_outcome is null or p_outcome not in ('retry','permanent_failure') then
    raise exception using errcode='22023',message='BILLING_FAILURE_OUTCOME_INVALID';
  end if;
  return dlkt_info_billing.finish_notice(p_account,p_event,p_attempt,p_outcome);
end;
$$;

create function dlkt_info_billing.claim_subscription(p_account text)
returns table(account_id text,subscription_id text,customer_id text,owner_id uuid,item_id text,price_id text,generation bigint,fence bigint,lease_until timestamptz)
language plpgsql security definer set search_path=pg_catalog as $$
declare v_row dlkt_info_billing.subscription_reconcile%rowtype; v_now timestamptz:=clock_timestamp();
begin
  if p_account is null or p_account !~ '^acct_[A-Za-z0-9]{1,250}$' then
    raise exception using errcode='22023',message='BILLING_ACCOUNT_INVALID';
  end if;
  with expired as (
    select q.account_id,q.subscription_id from dlkt_info_billing.subscription_reconcile q
    where q.account_id=p_account and q.state='leased' and q.attempt=5 and q.lease_until<=v_now
    order by q.lease_until,q.subscription_id limit 32 for update skip locked
  )
  update dlkt_info_billing.subscription_reconcile q set state='dead',lease_until=null
  from expired e where e.account_id=q.account_id and e.subscription_id=q.subscription_id;
  select q.* into v_row from dlkt_info_billing.subscription_reconcile q
  join dlkt_info_billing.subscription_bindings s on s.account_id=q.account_id and s.subscription_id=q.subscription_id
  join dlkt_info_billing.customer_bindings c on c.account_id=s.account_id and c.customer_id=s.customer_id
  where q.account_id=p_account and c.owner_id is not null and q.attempt<5
    and ((q.state='pending' and q.available_at<=v_now) or (q.state='leased' and q.lease_until<=v_now))
  order by case when q.state='leased' then q.lease_until else q.available_at end,q.subscription_id
  limit 1 for update of q skip locked;
  if not found then return; end if;
  update dlkt_info_billing.subscription_reconcile q set state='leased',attempt=q.attempt+1,
    fence=q.fence+1,lease_until=clock_timestamp()+interval '60 seconds'
  where q.account_id=v_row.account_id and q.subscription_id=v_row.subscription_id returning q.* into v_row;
  return query select s.account_id,s.subscription_id,s.customer_id,c.owner_id,s.item_id,s.price_id,
    v_row.generation,v_row.fence,v_row.lease_until
  from dlkt_info_billing.subscription_bindings s join dlkt_info_billing.customer_bindings c
    on c.account_id=s.account_id and c.customer_id=s.customer_id
  where s.account_id=v_row.account_id and s.subscription_id=v_row.subscription_id and c.owner_id is not null;
end;
$$;

-- This stores a non-authorizing observation, not payment evidence. The trusted
-- machine caller must obtain it via StripeReadClient after claiming this fence.
-- All identity fields must match the immutable server binding.
create function dlkt_info_billing.record_subscription_observation(
  p_account text,p_subscription text,p_generation bigint,p_fence bigint,
  p_owner uuid,p_customer text,p_item text,p_price text,p_status text
) returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare v_row dlkt_info_billing.subscription_reconcile%rowtype;
begin
  if p_status is null or p_status not in ('active','trialing','past_due','unpaid','canceled','incomplete','incomplete_expired','paused') then
    raise exception using errcode='22023',message='BILLING_STATUS_INVALID';
  end if;
  select q.* into v_row from dlkt_info_billing.subscription_reconcile q
  where q.account_id=p_account and q.subscription_id=p_subscription for update;
  if not found or v_row.state<>'leased' or v_row.generation is distinct from p_generation
    or v_row.fence is distinct from p_fence or v_row.lease_until<=clock_timestamp() then return false; end if;
  if not exists(select 1 from dlkt_info_billing.subscription_bindings s
    join dlkt_info_billing.customer_bindings c on c.account_id=s.account_id and c.customer_id=s.customer_id
    where s.account_id=p_account and s.subscription_id=p_subscription and s.customer_id=p_customer
      and s.item_id=p_item and s.price_id=p_price and c.owner_id=p_owner and c.owner_id is not null) then return false; end if;
  if v_row.lease_until<=clock_timestamp() then return false; end if;
  update dlkt_info_billing.subscription_reconcile q set state='observed',lease_until=null,
    observed_at=clock_timestamp(),observed_status=p_status
  where q.account_id=p_account and q.subscription_id=p_subscription;
  return true;
end;
$$;

create function dlkt_info_billing.fail_subscription(p_account text,p_subscription text,p_generation bigint,p_fence bigint,p_outcome text)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare v_row dlkt_info_billing.subscription_reconcile%rowtype; v_now timestamptz;
begin
  if p_outcome is null or p_outcome not in ('retry','permanent_failure') then
    raise exception using errcode='22023',message='BILLING_FAILURE_OUTCOME_INVALID';
  end if;
  select q.* into v_row from dlkt_info_billing.subscription_reconcile q
  where q.account_id=p_account and q.subscription_id=p_subscription for update;
  if not found then return false; end if;
  v_now:=clock_timestamp();
  if v_row.state<>'leased' or v_row.generation is distinct from p_generation or v_row.fence is distinct from p_fence
    or v_row.lease_until<=v_now then return false; end if;
  update dlkt_info_billing.subscription_reconcile q set
    state=case when p_outcome='permanent_failure' or q.attempt=5 then 'dead' else 'pending' end,
    lease_until=null,available_at=v_now+interval '30 seconds'
  where q.account_id=p_account and q.subscription_id=p_subscription;
  return true;
end;
$$;

grant create on schema dlkt_info_billing to dlkt_billing_queue_owner,dlkt_billing_reconcile_owner;
alter function dlkt_info_billing.route_subscription_notice(text,text,integer) owner to dlkt_billing_queue_owner;
alter function dlkt_info_billing.fail_notice(text,text,integer,text) owner to dlkt_billing_queue_owner;
alter function dlkt_info_billing.claim_subscription(text) owner to dlkt_billing_reconcile_owner;
alter function dlkt_info_billing.record_subscription_observation(text,text,bigint,bigint,uuid,text,text,text,text) owner to dlkt_billing_reconcile_owner;
alter function dlkt_info_billing.fail_subscription(text,text,bigint,bigint,text) owner to dlkt_billing_reconcile_owner;
revoke create on schema dlkt_info_billing from dlkt_billing_queue_owner,dlkt_billing_reconcile_owner;
revoke all on function dlkt_info_billing.finish_notice(text,text,integer,text) from dlkt_billing_worker;
revoke all on function dlkt_info_billing.route_subscription_notice(text,text,integer),
dlkt_info_billing.fail_notice(text,text,integer,text),
dlkt_info_billing.claim_subscription(text),
dlkt_info_billing.record_subscription_observation(text,text,bigint,bigint,uuid,text,text,text,text),
dlkt_info_billing.fail_subscription(text,text,bigint,bigint,text)
from public,anon,authenticated,service_role,dlkt_billing_worker,dlkt_billing_reconciler;
grant execute on function dlkt_info_billing.route_subscription_notice(text,text,integer),dlkt_info_billing.fail_notice(text,text,integer,text) to dlkt_billing_worker;
grant execute on function dlkt_info_billing.claim_subscription(text),dlkt_info_billing.record_subscription_observation(text,text,bigint,bigint,uuid,text,text,text,text),
dlkt_info_billing.fail_subscription(text,text,bigint,bigint,text) to dlkt_billing_reconciler;
commit;
