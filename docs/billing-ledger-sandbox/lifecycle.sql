-- Disposable laboratory only. No real user deletion or provider revocation.
begin;
create role dlkt_account_lifecycle_owner nologin noinherit nobypassrls;
create role dlkt_account_lifecycle_api nologin noinherit nobypassrls;
create role dlkt_account_lifecycle_review nologin noinherit nobypassrls;
create schema dlkt_info_account_lifecycle;
revoke all on schema dlkt_info_account_lifecycle from public,anon,authenticated,service_role;
grant usage on schema dlkt_info_account_lifecycle to dlkt_account_lifecycle_owner,dlkt_account_lifecycle_api,dlkt_account_lifecycle_review;

-- Restrict deletion while the case exists. No function to erase the case or
-- declare completion is supplied: remote obligations require real verification.
create table dlkt_info_account_lifecycle.closure_requests(
 owner_id uuid primary key references auth.users(id) on delete restrict,
 request_id uuid not null unique,
 requested_session_id uuid not null,
 requested_at timestamptz not null default clock_timestamp(),
 state text generated always as ('pending_cleanup'::text) stored
);
create table dlkt_info_account_lifecycle.closure_tasks(
 request_id uuid not null references dlkt_info_account_lifecycle.closure_requests(request_id),
 kind text not null check(kind in ('revoke_sessions','revoke_external_grants','resolve_checkout','resolve_subscriptions','review_retention','reconcile_inflight')),
 state text not null default 'pending' check(state in ('pending','manual_review','retry')),
 revision bigint not null default 0 check(revision>=0),
 blocker text check(blocker in ('provider_unavailable','manual_revocation_required','payment_state_unknown','fiscal_review_required','inflight_state_unknown','identity_revocation_unconfirmed')),
 updated_at timestamptz not null default clock_timestamp(),
 primary key(request_id,kind),
 check((state='pending' and blocker is null and revision=0) or (state in ('manual_review','retry') and blocker is not null and revision>0))
);
alter table dlkt_info_account_lifecycle.closure_requests enable row level security;
alter table dlkt_info_account_lifecycle.closure_tasks enable row level security;
revoke all on all tables in schema dlkt_info_account_lifecycle from public,anon,authenticated,service_role,dlkt_account_lifecycle_api,dlkt_account_lifecycle_review;
grant select,insert on dlkt_info_account_lifecycle.closure_requests,dlkt_info_account_lifecycle.closure_tasks to dlkt_account_lifecycle_owner;
grant update(state,blocker,revision,updated_at) on dlkt_info_account_lifecycle.closure_tasks to dlkt_account_lifecycle_owner;
create policy lifecycle_request_read on dlkt_info_account_lifecycle.closure_requests for select to dlkt_account_lifecycle_owner using(true);
create policy lifecycle_request_insert on dlkt_info_account_lifecycle.closure_requests for insert to dlkt_account_lifecycle_owner with check(true);
create policy lifecycle_task_read on dlkt_info_account_lifecycle.closure_tasks for select to dlkt_account_lifecycle_owner using(true);
create policy lifecycle_task_insert on dlkt_info_account_lifecycle.closure_tasks for insert to dlkt_account_lifecycle_owner with check(true);
create policy lifecycle_task_update on dlkt_info_account_lifecycle.closure_tasks for update to dlkt_account_lifecycle_owner using(true) with check(true);

grant usage on schema auth,dlkt_info_billing,dlkt_info_connection_vault to dlkt_account_lifecycle_owner;
grant select(id,user_id,not_after) on auth.sessions to dlkt_account_lifecycle_owner;
create policy dlkt_lifecycle_session_read on auth.sessions for select to dlkt_account_lifecycle_owner using(true);
grant select on dlkt_info_billing.customer_bindings,dlkt_info_billing.checkout_intents,dlkt_info_billing.subscription_bindings to dlkt_account_lifecycle_owner;
grant select(owner_id) on dlkt_info_connection_vault.connections,dlkt_info_connection_vault.pending_authorizations to dlkt_account_lifecycle_owner;
create policy lifecycle_customer_read on dlkt_info_billing.customer_bindings for select to dlkt_account_lifecycle_owner using(true);
create policy lifecycle_checkout_read on dlkt_info_billing.checkout_intents for select to dlkt_account_lifecycle_owner using(true);
create policy lifecycle_subscription_read on dlkt_info_billing.subscription_bindings for select to dlkt_account_lifecycle_owner using(true);
create policy lifecycle_vault_read on dlkt_info_connection_vault.connections for select to dlkt_account_lifecycle_owner using(true);
create policy lifecycle_pending_read on dlkt_info_connection_vault.pending_authorizations for select to dlkt_account_lifecycle_owner using(true);

-- All cooperating mutations take this owner-scoped transaction lock first.
-- This lab requires READ COMMITTED: a stale repeatable-read snapshot must
-- not allow a write after a different transaction has committed a hold.
create function dlkt_info_account_lifecycle.lock_owner(p_owner uuid) returns void
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if p_owner is null or current_setting('transaction_isolation')<>'read committed' then
   raise exception using errcode='55000',message='ACCOUNT_LIFECYCLE_CONTEXT_INVALID';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('dlkt-account-closure:'||p_owner::text,0));
end;
$$;
create function dlkt_info_account_lifecycle.require_open_account(p_owner uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$
begin
 perform dlkt_info_account_lifecycle.lock_owner(p_owner);
 if exists(select 1 from dlkt_info_account_lifecycle.closure_requests c where c.owner_id=p_owner) then
   raise exception using errcode='55000',message='ACCOUNT_CLOSING';
 end if;
end;
$$;
create function dlkt_info_account_lifecycle.require_identity(p_owner uuid,p_session uuid) returns void
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if p_owner is null or p_session is null or not exists(select 1 from auth.sessions s
 where s.id=p_session and s.user_id=p_owner and (s.not_after is null or s.not_after>clock_timestamp())) then
   raise exception using errcode='28000',message='ACCOUNT_SESSION_INVALID';
 end if;
end;
$$;

-- Trusted server supplies fresh verified identity and explicit confirmed intent.
-- SQL verifies a current session but is not a JWT verifier or reauthentication UI.
create function dlkt_info_account_lifecycle.request_closure(p_owner uuid,p_session uuid,p_request uuid)
returns table(request_id uuid,requested_at timestamptz,state text)
language plpgsql security definer set search_path=pg_catalog as $$
declare v_row dlkt_info_account_lifecycle.closure_requests%rowtype;
begin
 if p_request is null then raise exception using errcode='22023',message='ACCOUNT_REQUEST_INVALID'; end if;
 perform dlkt_info_account_lifecycle.require_identity(p_owner,p_session);
 perform dlkt_info_account_lifecycle.lock_owner(p_owner);
 perform dlkt_info_account_lifecycle.require_identity(p_owner,p_session);
 select c.* into v_row from dlkt_info_account_lifecycle.closure_requests c where c.owner_id=p_owner;
 if not found then
   insert into dlkt_info_account_lifecycle.closure_requests(owner_id,request_id,requested_session_id)
   values(p_owner,p_request,p_session) returning * into v_row;
   insert into dlkt_info_account_lifecycle.closure_tasks(request_id,kind)
   select v_row.request_id,k from unnest(array['revoke_sessions','revoke_external_grants','resolve_checkout','resolve_subscriptions','review_retention','reconcile_inflight']) as k;
 end if;
 return query select v_row.request_id,v_row.requested_at,v_row.state;
end;
$$;
create function dlkt_info_account_lifecycle.read_closure(p_owner uuid,p_session uuid)
returns table(request_id uuid,requested_at timestamptz,state text)
language plpgsql security definer set search_path=pg_catalog as $$
begin
 perform dlkt_info_account_lifecycle.require_identity(p_owner,p_session);
 return query select c.request_id,c.requested_at,c.state from dlkt_info_account_lifecycle.closure_requests c where c.owner_id=p_owner;
end;
$$;

-- Operator sees counts, not credentials or raw billing objects. A count of
-- zero is never proof that remote revocation or fiscal retention is resolved.
create function dlkt_info_account_lifecycle.inspect_closure(p_request uuid)
returns table(request_id uuid,owner_id uuid,state text,sessions bigint,connections bigint,pending_oauth bigint,open_checkout bigint,subscriptions bigint,billing_customers bigint)
language sql security definer set search_path=pg_catalog as $$
 select c.request_id,c.owner_id,c.state,
 (select count(*) from auth.sessions s where s.user_id=c.owner_id),
 (select count(*) from dlkt_info_connection_vault.connections v where v.owner_id=c.owner_id),
 (select count(*) from dlkt_info_connection_vault.pending_authorizations p where p.owner_id=c.owner_id),
 (select count(*) from dlkt_info_billing.checkout_intents i join dlkt_info_billing.customer_bindings b on b.account_id=i.account_id and b.customer_id=i.customer_id where b.owner_id=c.owner_id and i.state in ('reserved','attached')),
 (select count(*) from dlkt_info_billing.subscription_bindings s join dlkt_info_billing.customer_bindings b on b.account_id=s.account_id and b.customer_id=s.customer_id where b.owner_id=c.owner_id),
 (select count(*) from dlkt_info_billing.customer_bindings b where b.owner_id=c.owner_id)
 from dlkt_info_account_lifecycle.closure_requests c where c.request_id=p_request;
$$;
create function dlkt_info_account_lifecycle.read_tasks(p_request uuid)
returns table(kind text,state text,revision bigint,blocker text,updated_at timestamptz)
language sql security definer set search_path=pg_catalog as $$
 select t.kind,t.state,t.revision,t.blocker,t.updated_at from dlkt_info_account_lifecycle.closure_tasks t where t.request_id=p_request order by t.kind;
$$;
-- Record unresolved work only. No synthetic proof can mark a task complete.
create function dlkt_info_account_lifecycle.note_blocker(p_request uuid,p_kind text,p_expected bigint,p_state text,p_blocker text)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare n integer;
begin
 if p_expected is null or p_expected<0 or p_state is null or p_state not in ('retry','manual_review')
   or p_blocker is null or p_blocker not in ('provider_unavailable','manual_revocation_required','payment_state_unknown','fiscal_review_required','inflight_state_unknown','identity_revocation_unconfirmed') then return false; end if;
 update dlkt_info_account_lifecycle.closure_tasks t set state=p_state,blocker=p_blocker,revision=t.revision+1,updated_at=clock_timestamp()
 where t.request_id=p_request and t.kind=p_kind and t.revision=p_expected;
 get diagnostics n=row_count;
 return n=1;
end;
$$;

create function dlkt_info_account_lifecycle.guard_owner_write() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if tg_op='DELETE' then
   perform dlkt_info_account_lifecycle.require_open_account(old.owner_id);
   return old;
 end if;
 perform dlkt_info_account_lifecycle.require_open_account(new.owner_id);
 return new;
end;
$$;
create function dlkt_info_account_lifecycle.guard_new_checkout() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare v_owner uuid;
begin
 select c.owner_id into v_owner from dlkt_info_billing.customer_bindings c where c.account_id=new.account_id and c.customer_id=new.customer_id;
 perform dlkt_info_account_lifecycle.require_open_account(v_owner);
 return new;
end;
$$;
create function dlkt_info_account_lifecycle.guard_identity_delete() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 perform dlkt_info_account_lifecycle.require_open_account(old.id);
 if exists(select 1 from dlkt_info_billing.customer_bindings b where b.owner_id=old.id)
   or exists(select 1 from dlkt_info_connection_vault.connections v where v.owner_id=old.id)
   or exists(select 1 from dlkt_info_connection_vault.pending_authorizations p where p.owner_id=old.id) then
   raise exception using errcode='55000',message='ACCOUNT_CLEANUP_REQUIRED';
 end if;
 return old;
end;
$$;

grant create on schema dlkt_info_account_lifecycle to dlkt_account_lifecycle_owner;
alter function dlkt_info_account_lifecycle.lock_owner(uuid) owner to dlkt_account_lifecycle_owner;
alter function dlkt_info_account_lifecycle.require_open_account(uuid) owner to dlkt_account_lifecycle_owner;
alter function dlkt_info_account_lifecycle.require_identity(uuid,uuid) owner to dlkt_account_lifecycle_owner;
alter function dlkt_info_account_lifecycle.request_closure(uuid,uuid,uuid) owner to dlkt_account_lifecycle_owner;
alter function dlkt_info_account_lifecycle.read_closure(uuid,uuid) owner to dlkt_account_lifecycle_owner;
alter function dlkt_info_account_lifecycle.inspect_closure(uuid) owner to dlkt_account_lifecycle_owner;
alter function dlkt_info_account_lifecycle.read_tasks(uuid) owner to dlkt_account_lifecycle_owner;
alter function dlkt_info_account_lifecycle.note_blocker(uuid,text,bigint,text,text) owner to dlkt_account_lifecycle_owner;
alter function dlkt_info_account_lifecycle.guard_owner_write() owner to dlkt_account_lifecycle_owner;
alter function dlkt_info_account_lifecycle.guard_new_checkout() owner to dlkt_account_lifecycle_owner;
alter function dlkt_info_account_lifecycle.guard_identity_delete() owner to dlkt_account_lifecycle_owner;
revoke create on schema dlkt_info_account_lifecycle from dlkt_account_lifecycle_owner;
revoke all on all functions in schema dlkt_info_account_lifecycle from public,anon,authenticated,service_role,dlkt_account_lifecycle_api,dlkt_account_lifecycle_review;
grant execute on function dlkt_info_account_lifecycle.request_closure(uuid,uuid,uuid),dlkt_info_account_lifecycle.read_closure(uuid,uuid) to dlkt_account_lifecycle_api;
grant execute on function dlkt_info_account_lifecycle.inspect_closure(uuid),dlkt_info_account_lifecycle.read_tasks(uuid),
dlkt_info_account_lifecycle.note_blocker(uuid,text,bigint,text,text) to dlkt_account_lifecycle_review;
grant usage on schema dlkt_info_account_lifecycle to dlkt_connection_vault_owner,dlkt_billing_checkout_owner,dlkt_billing_entitlement_owner;
grant execute on function dlkt_info_account_lifecycle.require_open_account(uuid) to dlkt_connection_vault_owner,dlkt_billing_checkout_owner;
grant select(owner_id) on dlkt_info_account_lifecycle.closure_requests to dlkt_billing_entitlement_owner;
create policy lifecycle_entitlement_hold_read on dlkt_info_account_lifecycle.closure_requests for select to dlkt_billing_entitlement_owner using(true);

-- Database-side closure gate. Existing checkout terminal processing is still
-- permitted, because a delayed provider completion is a financial obligation.
-- Ordinary vault access is frozen; do not deploy before dedicated cleanup
-- access is available and all legacy connection records are migrated/reviewed.
create or replace function dlkt_info_connection_vault.require_session(p_owner uuid,p_session uuid)
returns void language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if p_owner is null or p_session is null or not exists(
    select 1 from auth.sessions s where s.id=p_session and s.user_id=p_owner
      and (s.not_after is null or s.not_after>clock_timestamp())
  ) then raise exception using errcode='28000',message='VAULT_SESSION_INVALID'; end if;
  perform dlkt_info_account_lifecycle.require_open_account(p_owner);
end;
$;
create or replace function dlkt_info_billing.reserve_checkout(p_account text,p_owner uuid,p_plan text,p_intent uuid)
returns table(intent_id uuid,account_id text,customer_id text,owner_id uuid,price_id text,created_at bigint,expires_at bigint,session_id text,state text)
language plpgsql security definer set search_path=pg_catalog as $$
declare v_customer text; v_price text; v_created timestamptz; v_row dlkt_info_billing.checkout_intents%rowtype;
begin
  if p_owner is null or p_intent is null or p_plan is null or p_plan not in ('monthly','annual') then return; end if;
  perform dlkt_info_account_lifecycle.require_open_account(p_owner);
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
create or replace function dlkt_info_billing.attach_checkout(p_account text,p_intent uuid,p_owner uuid,p_customer text,p_price text,p_session text,p_expiry bigint)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare v_row dlkt_info_billing.checkout_intents%rowtype;
begin
  if p_session is null or p_session !~ '^cs_test_[A-Za-z0-9]{1,247}$' then return false; end if;
  perform dlkt_info_account_lifecycle.require_open_account(p_owner);
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
create or replace function dlkt_info_billing.read_entitlement_fixture(p_account text,p_owner uuid)
returns table(account_id text,owner_id uuid,customer_id text,subscription_id text,item_id text,price_id text,product_id text,invoice_id text,
 generation bigint,fence bigint,epoch bigint,verified_at bigint,period_start bigint,period_end bigint,cancel_at bigint,valid_until bigint,source text)
language sql security definer set search_path=pg_catalog as $$
  select e.account_id,c.owner_id,s.customer_id,s.subscription_id,s.item_id,s.price_id,a.product_id,e.invoice_id,
    e.generation,e.fence,e.epoch,e.verified_at,e.period_start,e.period_end,e.cancel_at,e.valid_until,e.source
  from dlkt_info_billing.entitlement_fixture_candidates e
  join dlkt_info_billing.subscription_reconcile q on q.account_id=e.account_id and q.subscription_id=e.subscription_id
  join dlkt_info_billing.subscription_bindings s on s.account_id=e.account_id and s.subscription_id=e.subscription_id
  join dlkt_info_billing.customer_bindings c on c.account_id=s.account_id and c.customer_id=s.customer_id
  join dlkt_info_billing.catalog_accounts a on a.account_id=e.account_id
  join dlkt_info_billing.checkout_intents i on i.account_id=s.account_id and i.customer_id=s.customer_id and i.completed_subscription_id=s.subscription_id
  where e.account_id=p_account and c.owner_id=p_owner and a.live_mode=false
    and not exists(select 1 from dlkt_info_account_lifecycle.closure_requests cr where cr.owner_id=c.owner_id)
    and i.state='complete' and i.price_id=s.price_id
    and q.state='observed' and q.observed_status='active' and q.generation=e.generation and q.fence=e.fence
    and e.epoch=coalesce((select n.epoch from dlkt_info_billing.notice_epoch n where n.account_id=e.account_id),0)
    and not exists(select 1 from dlkt_info_billing.event_jobs j where j.account_id=e.account_id and j.state<>'routed')
    and e.period_start<=extract(epoch from clock_timestamp())
    and e.verified_at<=extract(epoch from clock_timestamp()) and e.valid_until>extract(epoch from clock_timestamp());
$$;
create trigger lifecycle_customer_insert before insert on dlkt_info_billing.customer_bindings
for each row execute function dlkt_info_account_lifecycle.guard_owner_write();
create trigger lifecycle_checkout_insert before insert on dlkt_info_billing.checkout_intents
for each row execute function dlkt_info_account_lifecycle.guard_new_checkout();
create trigger lifecycle_vault_write before insert or update or delete on dlkt_info_connection_vault.connections
for each row execute function dlkt_info_account_lifecycle.guard_owner_write();
-- Pending OAuth deletion is intentionally allowed for auth-session cascades.
create trigger lifecycle_pending_write before insert or update on dlkt_info_connection_vault.pending_authorizations
for each row execute function dlkt_info_account_lifecycle.guard_owner_write();
create trigger lifecycle_identity_delete before delete on auth.users
for each row execute function dlkt_info_account_lifecycle.guard_identity_delete();
commit;
