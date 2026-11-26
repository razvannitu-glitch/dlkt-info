-- Disposable PostgreSQL only. No live migration.
begin;
create role dlkt_billing_checkout_owner nologin noinherit nobypassrls;
create role dlkt_billing_checkout_api nologin noinherit nobypassrls;
create role dlkt_billing_checkout_recovery nologin noinherit nobypassrls;
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
commit;
