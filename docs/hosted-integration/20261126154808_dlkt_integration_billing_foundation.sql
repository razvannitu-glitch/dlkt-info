-- Hosted integration foundation ONLY; target hziavqdhsqnihxuuxzhn.
-- Source snapshot 1a971c8070dd3ad7e5b7e38e31a259238c570500; ledger/queue/reconcile/checkout, no fixtures.
do $$
begin
 if exists(select 1 from pg_namespace where nspname='dlkt_info_billing') then raise exception 'BILLING_SCHEMA_ALREADY_EXISTS';end if;
 if exists(select 1 from auth.users) or exists(select 1 from auth.sessions) then raise exception 'INTEGRATION_NOT_EMPTY';end if;
end;
$$;
-- Isolated candidate only. DO NOT APPLY TO PRODUCTION.
-- No migration registration, public RPC, Stripe calls or entitlement grants.

create schema dlkt_info_billing;
revoke all on schema dlkt_info_billing from public, anon, authenticated, service_role;
grant usage on schema dlkt_info_billing to service_role;

create table dlkt_info_billing.catalog_accounts (
  account_id text primary key check (account_id ~ '^acct_[A-Za-z0-9]{1,250}$'),
  product_id text not null check (product_id ~ '^prod_[A-Za-z0-9]{1,250}$'),
  live_mode boolean not null default false check (live_mode = false)
);
create table dlkt_info_billing.catalog_prices (
  account_id text not null references dlkt_info_billing.catalog_accounts(account_id),
  price_id text not null check (price_id ~ '^price_[A-Za-z0-9]{1,249}$'),
  plan text not null check (plan in ('monthly','annual')),
  amount_cents integer not null,
  currency text not null default 'eur' check (currency = 'eur'),
  primary key (account_id, price_id),
  unique (account_id, plan),
  check ((plan = 'monthly' and amount_cents = 699) or (plan = 'annual' and amount_cents = 6900))
);
create table dlkt_info_billing.customer_bindings (
  account_id text not null references dlkt_info_billing.catalog_accounts(account_id),
  customer_id text not null check (customer_id ~ '^cus_[A-Za-z0-9]{1,251}$'),
  owner_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (account_id, customer_id),
  unique (account_id, owner_id)
);
-- Preserve an unassignable tombstone on Auth deletion; no runtime update/delete grant.
-- Retention/cancellation orchestration is a separate release gate.
create function dlkt_info_billing.require_initial_owner() returns trigger
language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if new.owner_id is null then
    raise exception using errcode = '23502', message = 'BILLING_OWNER_REQUIRED';
  end if;
  return new;
end;
$$;
revoke all on function dlkt_info_billing.require_initial_owner() from public, anon, authenticated, service_role;
create trigger require_initial_owner before insert on dlkt_info_billing.customer_bindings
for each row execute function dlkt_info_billing.require_initial_owner();

create table dlkt_info_billing.subscription_bindings (
  account_id text not null,
  customer_id text not null,
  subscription_id text not null check (subscription_id ~ '^sub_[A-Za-z0-9]{1,251}$'),
  price_id text not null,
  item_id text not null check (item_id ~ '^si_[A-Za-z0-9]{1,252}$'),
  created_at timestamptz not null default clock_timestamp(),
  primary key (account_id, subscription_id),
  unique (account_id, item_id),
  foreign key (account_id, customer_id) references dlkt_info_billing.customer_bindings(account_id, customer_id),
  foreign key (account_id, price_id) references dlkt_info_billing.catalog_prices(account_id, price_id)
);
create index subscription_bindings_customer_idx on dlkt_info_billing.subscription_bindings(account_id, customer_id);

-- This increment reserves a single checkout slot. It deliberately cannot close or
-- reuse a slot from the application role: verified terminal transitions are not built yet.
create table dlkt_info_billing.checkout_intents (
  intent_id uuid primary key,
  account_id text not null,
  customer_id text not null,
  price_id text not null,
  created_at timestamptz not null default clock_timestamp(),
  closed_at timestamptz,
  foreign key (account_id, customer_id) references dlkt_info_billing.customer_bindings(account_id, customer_id),
  foreign key (account_id, price_id) references dlkt_info_billing.catalog_prices(account_id, price_id),
  check (closed_at is null or closed_at >= created_at)
);
create unique index checkout_intents_one_open_idx
on dlkt_info_billing.checkout_intents(account_id, customer_id) where closed_at is null;

-- Persist only deduplication identity and validated routing metadata. No raw payload,
-- secret, customer email, payment card or entitlement evidence.
create table dlkt_info_billing.event_notices (
  account_id text not null references dlkt_info_billing.catalog_accounts(account_id),
  event_id text not null check (event_id ~ '^evt_[A-Za-z0-9]{1,251}$'),
  event_type text not null check (event_type in (
    'checkout.session.completed','checkout.session.async_payment_succeeded',
    'checkout.session.async_payment_failed','checkout.session.expired',
    'customer.subscription.created','customer.subscription.updated',
    'customer.subscription.deleted','customer.subscription.paused',
    'customer.subscription.resumed','invoice.paid','invoice.payment_failed',
    'charge.refunded','charge.dispute.created','radar.early_fraud_warning.created'
  )),
  object_id text not null check (length(object_id) <= 255),
  event_created bigint not null check (event_created between 1 and 253402300799),
  received_at timestamptz not null default clock_timestamp(),
  primary key (account_id, event_id),
  check (
    (event_type like 'checkout.session.%' and object_id ~ '^cs_test_[A-Za-z0-9]+$') or
    (event_type like 'customer.subscription.%' and object_id ~ '^sub_[A-Za-z0-9]+$') or
    (event_type like 'invoice.%' and object_id ~ '^in_[A-Za-z0-9]+$') or
    (event_type = 'charge.refunded' and object_id ~ '^ch_[A-Za-z0-9]+$') or
    (event_type = 'charge.dispute.created' and object_id ~ '^dp_[A-Za-z0-9]+$') or
    (event_type = 'radar.early_fraud_warning.created' and object_id ~ '^issfr_[A-Za-z0-9]+$')
  )
);
alter table dlkt_info_billing.catalog_accounts enable row level security;
alter table dlkt_info_billing.catalog_prices enable row level security;
alter table dlkt_info_billing.customer_bindings enable row level security;
alter table dlkt_info_billing.subscription_bindings enable row level security;
alter table dlkt_info_billing.checkout_intents enable row level security;
alter table dlkt_info_billing.event_notices enable row level security;
revoke all on all tables in schema dlkt_info_billing from public, anon, authenticated, service_role;
grant select on all tables in schema dlkt_info_billing to service_role;
grant insert (account_id, customer_id, owner_id) on dlkt_info_billing.customer_bindings to service_role;
grant insert (account_id, customer_id, subscription_id, price_id, item_id) on dlkt_info_billing.subscription_bindings to service_role;
grant insert (intent_id, account_id, customer_id, price_id) on dlkt_info_billing.checkout_intents to service_role;
grant insert (account_id, event_id, event_type, object_id, event_created) on dlkt_info_billing.event_notices to service_role;


-- Disposable PostgreSQL candidate only. DO NOT APPLY TO PRODUCTION.

-- Separate machine roles. The definer is not a superuser, cannot log in or bypass RLS,
-- and owns only the three queue functions, not the underlying tables.
create role dlkt_billing_queue_owner nologin noinherit nobypassrls;
grant dlkt_billing_queue_owner to postgres with set true, inherit true;
create role dlkt_billing_worker nologin noinherit nobypassrls;
grant dlkt_billing_worker to postgres with set true, inherit true;
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


-- Disposable PostgreSQL candidate. NOT a production migration.

create role dlkt_billing_reconcile_owner nologin noinherit nobypassrls;
grant dlkt_billing_reconcile_owner to postgres with set true, inherit true;
create role dlkt_billing_reconciler nologin noinherit nobypassrls;
grant dlkt_billing_reconciler to postgres with set true, inherit true;
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


-- Disposable PostgreSQL only. No live migration.

create role dlkt_billing_checkout_owner nologin noinherit nobypassrls;
grant dlkt_billing_checkout_owner to postgres with set true, inherit true;
create role dlkt_billing_checkout_api nologin noinherit nobypassrls;
grant dlkt_billing_checkout_api to postgres with set true, inherit true;
create role dlkt_billing_checkout_recovery nologin noinherit nobypassrls;
grant dlkt_billing_checkout_recovery to postgres with set true, inherit true;
grant usage on schema dlkt_info_billing to dlkt_billing_checkout_owner,dlkt_billing_checkout_api,dlkt_billing_checkout_recovery;

alter table dlkt_info_billing.checkout_intents
  add column state text not null default 'reserved',
  add column session_id text,
  add column expires_at bigint,
  add column completed_subscription_id text;
-- Existing rows are disposable fixture reservations, not real financial history.
update dlkt_info_billing.checkout_intents set created_at=date_trunc('second',created_at),
  expires_at=floor(extract(epoch from created_at))::bigint+3600;
alter table dlkt_info_billing.checkout_intents alter column expires_at set not null;
alter table dlkt_info_billing.checkout_intents
  add constraint checkout_session_id_valid check (session_id is null or session_id ~ '^cs_test_[A-Za-z0-9]{1,247}$'),
  add constraint checkout_expiry_fixed check (expires_at=floor(extract(epoch from created_at))::bigint+3600),
  add constraint checkout_state_valid check (
    (state='reserved' and session_id is null and closed_at is null and completed_subscription_id is null)
    or (state='attached' and session_id is not null and closed_at is null and completed_subscription_id is null)
    or (state='expired' and session_id is not null and closed_at is not null and completed_subscription_id is null)
    or (state='complete' and session_id is not null and closed_at is not null and completed_subscription_id is not null)
  ),
  add constraint checkout_completed_subscription_fk foreign key(account_id,completed_subscription_id)
    references dlkt_info_billing.subscription_bindings(account_id,subscription_id);
-- FIRST-PURCHASE LAB ONLY. Even verified expiration does not authorize a
-- replacement intent; restarting safely requires a separate commercial workflow.
create unique index checkout_intents_first_purchase_idx on dlkt_info_billing.checkout_intents(account_id,customer_id);
create unique index checkout_intents_session_idx on dlkt_info_billing.checkout_intents(account_id,session_id) where session_id is not null;
create unique index subscription_bindings_first_purchase_idx on dlkt_info_billing.subscription_bindings(account_id,customer_id);

revoke insert (intent_id,account_id,customer_id,price_id) on dlkt_info_billing.checkout_intents from service_role;
revoke insert (account_id,customer_id,subscription_id,price_id,item_id) on dlkt_info_billing.subscription_bindings from service_role;
grant select on dlkt_info_billing.customer_bindings,dlkt_info_billing.catalog_prices,dlkt_info_billing.subscription_bindings,
dlkt_info_billing.checkout_intents,dlkt_info_billing.subscription_reconcile to dlkt_billing_checkout_owner;
grant insert(intent_id,account_id,customer_id,price_id,created_at,expires_at) on dlkt_info_billing.checkout_intents to dlkt_billing_checkout_owner;
grant update(state,session_id,closed_at,completed_subscription_id) on dlkt_info_billing.checkout_intents to dlkt_billing_checkout_owner;
grant insert(account_id,customer_id,subscription_id,price_id,item_id) on dlkt_info_billing.subscription_bindings to dlkt_billing_checkout_owner;
grant insert(account_id,subscription_id) on dlkt_info_billing.subscription_reconcile to dlkt_billing_checkout_owner;
create policy checkout_owner_customer_read on dlkt_info_billing.customer_bindings for select to dlkt_billing_checkout_owner using(true);
create policy checkout_owner_price_read on dlkt_info_billing.catalog_prices for select to dlkt_billing_checkout_owner using(true);
create policy checkout_owner_subscription_read on dlkt_info_billing.subscription_bindings for select to dlkt_billing_checkout_owner using(true);
create policy checkout_owner_subscription_insert on dlkt_info_billing.subscription_bindings for insert to dlkt_billing_checkout_owner with check(true);
create policy checkout_owner_intent_read on dlkt_info_billing.checkout_intents for select to dlkt_billing_checkout_owner using(true);
create policy checkout_owner_intent_insert on dlkt_info_billing.checkout_intents for insert to dlkt_billing_checkout_owner with check(true);
create policy checkout_owner_intent_update on dlkt_info_billing.checkout_intents for update to dlkt_billing_checkout_owner using(true) with check(true);
create policy checkout_owner_reconcile_read on dlkt_info_billing.subscription_reconcile for select to dlkt_billing_checkout_owner using(true);
create policy checkout_owner_reconcile_insert on dlkt_info_billing.subscription_reconcile for insert to dlkt_billing_checkout_owner with check(true);

-- Machine-only functions. An authenticated server resolves the owner, never a
-- browser-supplied UUID. Provider observation must precede either record call.
create function dlkt_info_billing.reserve_checkout(p_account text,p_owner uuid,p_plan text,p_intent uuid)
returns table(intent_id uuid,account_id text,customer_id text,owner_id uuid,price_id text,created_at bigint,expires_at bigint,session_id text,state text)
language plpgsql security definer set search_path=pg_catalog as $$
declare v_customer text; v_price text; v_created timestamptz; v_row dlkt_info_billing.checkout_intents%rowtype;
begin
  if p_owner is null or p_intent is null or p_plan is null or p_plan not in ('monthly','annual') then return; end if;
  select c.customer_id,p.price_id into v_customer,v_price from dlkt_info_billing.customer_bindings c
    join dlkt_info_billing.catalog_prices p on p.account_id=c.account_id
    where c.account_id=p_account and c.owner_id=p_owner and p.plan=p_plan;
  if not found then return; end if;
  -- Serialize the reservation for one immutable customer; a hash collision
  -- only causes benign contention. Uniqueness remains enforced by PostgreSQL.
  perform pg_advisory_xact_lock(hashtextextended(p_account||':'||v_customer,0));
  if not exists(select 1 from dlkt_info_billing.customer_bindings c where c.account_id=p_account and c.customer_id=v_customer and c.owner_id=p_owner) then return; end if;
  if exists(select 1 from dlkt_info_billing.subscription_bindings s where s.account_id=p_account and s.customer_id=v_customer) then return; end if;
  select q.* into v_row from dlkt_info_billing.checkout_intents q where q.account_id=p_account and q.customer_id=v_customer for update;
  if not found then
    v_created:=date_trunc('second',clock_timestamp());
    insert into dlkt_info_billing.checkout_intents(intent_id,account_id,customer_id,price_id,created_at,expires_at)
    values(p_intent,p_account,v_customer,v_price,v_created,extract(epoch from v_created)::bigint+3600)
    returning * into v_row;
  end if;
  if v_row.price_id<>v_price or v_row.state not in ('reserved','attached') then return; end if;
  return query select v_row.intent_id,v_row.account_id,v_row.customer_id,p_owner,v_row.price_id,
    extract(epoch from v_row.created_at)::bigint,v_row.expires_at,v_row.session_id,v_row.state;
end;
$$;

create function dlkt_info_billing.read_checkout(p_account text,p_intent uuid)
returns table(intent_id uuid,account_id text,customer_id text,owner_id uuid,price_id text,created_at bigint,expires_at bigint,session_id text,state text)
language sql security definer set search_path=pg_catalog as $$
  select q.intent_id,q.account_id,q.customer_id,c.owner_id,q.price_id,extract(epoch from q.created_at)::bigint,q.expires_at,q.session_id,q.state
  from dlkt_info_billing.checkout_intents q join dlkt_info_billing.customer_bindings c
    on c.account_id=q.account_id and c.customer_id=q.customer_id
  where q.account_id=p_account and q.intent_id=p_intent and c.owner_id is not null and q.state in ('reserved','attached');
$$;

create function dlkt_info_billing.attach_checkout(p_account text,p_intent uuid,p_owner uuid,p_customer text,p_price text,p_session text,p_expiry bigint)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare v_row dlkt_info_billing.checkout_intents%rowtype;
begin
  if p_session is null or p_session !~ '^cs_test_[A-Za-z0-9]{1,247}$' then return false; end if;
  select q.* into v_row from dlkt_info_billing.checkout_intents q where q.account_id=p_account and q.intent_id=p_intent for update;
  if not found or v_row.customer_id is distinct from p_customer or v_row.price_id is distinct from p_price
    or v_row.expires_at is distinct from p_expiry or v_row.state not in ('reserved','attached')
    or v_row.expires_at<=extract(epoch from clock_timestamp())
    or (v_row.session_id is not null and v_row.session_id<>p_session) then return false; end if;
  if not exists(select 1 from dlkt_info_billing.customer_bindings c where c.account_id=p_account and c.customer_id=p_customer and c.owner_id=p_owner) then return false; end if;
  update dlkt_info_billing.checkout_intents q set state='attached',session_id=p_session where q.intent_id=p_intent;
  return true;
exception when unique_violation then return false;
end;
$$;

-- No timeout, cancel redirect, client metadata, or missing response closes a slot.
-- The recovery role supplies a fresh exact Stripe GET observation. Complete
-- records a binding and enqueues reconciliation in one transaction, NOT access.
create function dlkt_info_billing.finish_checkout(p_account text,p_intent uuid,p_owner uuid,p_customer text,p_price text,p_session text,p_expiry bigint,
  p_status text,p_payment_status text,p_subscription text,p_item text)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare v_row dlkt_info_billing.checkout_intents%rowtype; v_sub dlkt_info_billing.subscription_bindings%rowtype;
begin
  if p_session is null or p_session !~ '^cs_test_[A-Za-z0-9]{1,247}$' then return false; end if;
  if p_status='expired' and p_payment_status='unpaid' and p_subscription is null and p_item is null then null;
  elsif p_status='complete' and p_payment_status='paid' and p_subscription ~ '^sub_[A-Za-z0-9]{1,251}$' and p_item ~ '^si_[A-Za-z0-9]{1,252}$' then null;
  else return false; end if;
  select q.* into v_row from dlkt_info_billing.checkout_intents q where q.account_id=p_account and q.intent_id=p_intent for update;
  if not found or v_row.customer_id is distinct from p_customer or v_row.price_id is distinct from p_price
    or v_row.expires_at is distinct from p_expiry or (v_row.session_id is not null and v_row.session_id<>p_session) then return false; end if;
  if not exists(select 1 from dlkt_info_billing.customer_bindings c where c.account_id=p_account and c.customer_id=p_customer and c.owner_id=p_owner) then return false; end if;
  if v_row.state in ('complete','expired') then
    if v_row.state<>p_status or v_row.completed_subscription_id is distinct from p_subscription then return false; end if;
    if p_status='complete' then
      return exists(select 1 from dlkt_info_billing.subscription_bindings s where s.account_id=p_account and s.subscription_id=p_subscription and s.customer_id=p_customer and s.price_id=p_price and s.item_id=p_item)
        and exists(select 1 from dlkt_info_billing.subscription_reconcile q where q.account_id=p_account and q.subscription_id=p_subscription);
    end if;
    return true;
  end if;
  if p_status='expired' then
    if exists(select 1 from dlkt_info_billing.subscription_bindings s where s.account_id=p_account and s.customer_id=p_customer) then return false; end if;
  else
    insert into dlkt_info_billing.subscription_bindings(account_id,customer_id,subscription_id,price_id,item_id)
    values(p_account,p_customer,p_subscription,p_price,p_item) on conflict do nothing;
    select s.* into v_sub from dlkt_info_billing.subscription_bindings s where s.account_id=p_account and s.subscription_id=p_subscription;
    if not found or v_sub.customer_id<>p_customer or v_sub.price_id<>p_price or v_sub.item_id<>p_item then
      raise exception using errcode='23514',message='BILLING_SUBSCRIPTION_BINDING_CONFLICT';
    end if;
    insert into dlkt_info_billing.subscription_reconcile(account_id,subscription_id)
    values(p_account,p_subscription) on conflict do nothing;
  end if;
  update dlkt_info_billing.checkout_intents q set state=p_status,session_id=p_session,closed_at=clock_timestamp(),completed_subscription_id=p_subscription
    where q.intent_id=p_intent;
  return true;
exception when unique_violation or check_violation then return false;
end;
$$;

grant create on schema dlkt_info_billing to dlkt_billing_checkout_owner;
alter function dlkt_info_billing.reserve_checkout(text,uuid,text,uuid) owner to dlkt_billing_checkout_owner;
alter function dlkt_info_billing.read_checkout(text,uuid) owner to dlkt_billing_checkout_owner;
alter function dlkt_info_billing.attach_checkout(text,uuid,uuid,text,text,text,bigint) owner to dlkt_billing_checkout_owner;
alter function dlkt_info_billing.finish_checkout(text,uuid,uuid,text,text,text,bigint,text,text,text,text) owner to dlkt_billing_checkout_owner;
revoke create on schema dlkt_info_billing from dlkt_billing_checkout_owner;
revoke all on function dlkt_info_billing.reserve_checkout(text,uuid,text,uuid),dlkt_info_billing.read_checkout(text,uuid),
dlkt_info_billing.attach_checkout(text,uuid,uuid,text,text,text,bigint),dlkt_info_billing.finish_checkout(text,uuid,uuid,text,text,text,bigint,text,text,text,text)
from public,anon,authenticated,service_role,dlkt_billing_checkout_api,dlkt_billing_checkout_recovery;
grant execute on function dlkt_info_billing.reserve_checkout(text,uuid,text,uuid),dlkt_info_billing.attach_checkout(text,uuid,uuid,text,text,text,bigint)
to dlkt_billing_checkout_api;
grant execute on function dlkt_info_billing.read_checkout(text,uuid),dlkt_info_billing.attach_checkout(text,uuid,uuid,text,text,text,bigint),
dlkt_info_billing.finish_checkout(text,uuid,uuid,text,text,text,bigint,text,text,text,text) to dlkt_billing_checkout_recovery;


-- Machine roles are NOLOGIN until dedicated runtime provisioning is reviewed.
create role dlkt_billing_customer_writer nologin noinherit nobypassrls;
create role dlkt_billing_ingress nologin noinherit nobypassrls;
create role dlkt_billing_catalog_reader nologin noinherit nobypassrls;
revoke all on all tables in schema dlkt_info_billing from service_role,public,anon,authenticated;
revoke insert(account_id,customer_id,owner_id) on dlkt_info_billing.customer_bindings from service_role;
revoke all on all functions in schema dlkt_info_billing from service_role,public,anon,authenticated;
revoke all on schema dlkt_info_billing from service_role,public,anon,authenticated;
grant usage on schema dlkt_info_billing to dlkt_billing_customer_writer,dlkt_billing_ingress,dlkt_billing_catalog_reader;
grant insert(account_id,customer_id,owner_id) on dlkt_info_billing.customer_bindings to dlkt_billing_customer_writer;
create policy hosted_customer_insert on dlkt_info_billing.customer_bindings for insert to dlkt_billing_customer_writer with check(owner_id is not null);
grant select on dlkt_info_billing.catalog_accounts,dlkt_info_billing.catalog_prices to dlkt_billing_catalog_reader;
create policy hosted_account_read on dlkt_info_billing.catalog_accounts for select to dlkt_billing_catalog_reader using(true);
create policy hosted_price_read on dlkt_info_billing.catalog_prices for select to dlkt_billing_catalog_reader using(true);
grant execute on function dlkt_info_billing.ingest_notice(text,text,text,text,bigint) to dlkt_billing_ingress;
-- Revoke temporary inheritance before committing. Only the existing project
-- administrator retains explicit SET ROLE to maintain the owned functions.
grant dlkt_billing_queue_owner to postgres with set true, inherit false;
grant dlkt_billing_worker to postgres with set true, inherit false;
grant dlkt_billing_reconcile_owner to postgres with set true, inherit false;
grant dlkt_billing_reconciler to postgres with set true, inherit false;
grant dlkt_billing_checkout_owner to postgres with set true, inherit false;
grant dlkt_billing_checkout_api to postgres with set true, inherit false;
grant dlkt_billing_checkout_recovery to postgres with set true, inherit false;
do $$
declare r text;t record;f record;
begin
 foreach r in array array['anon','authenticated','service_role','authenticator'] loop
  if has_schema_privilege(r,'dlkt_info_billing','USAGE') then raise exception 'Broad schema access: %',r;end if;
  for t in select c.oid,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='dlkt_info_billing' and c.relkind='r' loop
    if not t.relrowsecurity or has_table_privilege(r,t.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or has_any_column_privilege(r,t.oid,'SELECT,INSERT,UPDATE,REFERENCES') then raise exception 'Broad table access: %',r;end if;
  end loop;
  for f in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='dlkt_info_billing' loop
    if has_function_privilege(r,f.oid,'EXECUTE') then raise exception 'Broad function access: % / %',r,f.proname;end if;
  end loop;
 end loop;
 if exists(select 1 from pg_roles where rolname like 'dlkt_billing_%' and (rolcanlogin or rolsuper or rolbypassrls or rolcreaterole or rolcreatedb)) then raise exception 'Unrestricted billing role';end if;
 if exists(select 1 from pg_roles where rolname like 'dlkt_billing_%' and (pg_has_role('authenticated',oid,'MEMBER') or pg_has_role('anon',oid,'MEMBER') or pg_has_role('service_role',oid,'MEMBER') or pg_has_role('authenticator',oid,'MEMBER'))) then raise exception 'Unsafe role membership';end if;
 if exists(select 1 from pg_auth_members m join pg_roles r on r.oid=m.roleid join pg_roles u on u.oid=m.member where r.rolname like 'dlkt_billing_%' and u.rolname='postgres' and m.inherit_option) then raise exception 'Administrative temporary inheritance retained';end if;
 if not has_function_privilege('dlkt_billing_ingress','dlkt_info_billing.ingest_notice(text,text,text,text,bigint)','EXECUTE')
 or not has_function_privilege('dlkt_billing_worker','dlkt_info_billing.claim_notice(text)','EXECUTE')
 or not has_function_privilege('dlkt_billing_worker','dlkt_info_billing.route_subscription_notice(text,text,integer)','EXECUTE')
 or not has_function_privilege('dlkt_billing_reconciler','dlkt_info_billing.claim_subscription(text)','EXECUTE')
 or not has_function_privilege('dlkt_billing_checkout_api','dlkt_info_billing.reserve_checkout(text,uuid,text,uuid)','EXECUTE')
 or not has_function_privilege('dlkt_billing_checkout_recovery','dlkt_info_billing.finish_checkout(text,uuid,uuid,text,text,text,bigint,text,text,text,text)','EXECUTE')
 then raise exception 'Missing expected machine function grant';end if;
end;
$$;
