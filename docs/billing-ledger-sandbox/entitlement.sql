-- Laboratory only. Synthetic candidates, NEVER a production authorization.
begin;
create role dlkt_billing_entitlement_owner nologin noinherit nobypassrls;
create role dlkt_billing_entitlement_reader nologin noinherit nobypassrls;
create role dlkt_billing_evidence_fixture nologin noinherit nobypassrls;
grant usage on schema dlkt_info_billing to dlkt_billing_entitlement_owner,dlkt_billing_entitlement_reader,dlkt_billing_evidence_fixture;

-- An accepted notice invalidates the whole sandbox account immediately, even
-- before its subscription is known. Deliberately conservative until reliable
-- invoice/charge/dispute -> subscription linkage is implemented.
create table dlkt_info_billing.notice_epoch (
  account_id text primary key references dlkt_info_billing.catalog_accounts(account_id),
  epoch bigint not null check(epoch>=1)
);
insert into dlkt_info_billing.notice_epoch(account_id,epoch)
select account_id,count(*) from dlkt_info_billing.event_notices group by account_id;
alter table dlkt_info_billing.notice_epoch enable row level security;
revoke all on dlkt_info_billing.notice_epoch from public,anon,authenticated,service_role;
grant select,insert,update on dlkt_info_billing.notice_epoch to dlkt_billing_entitlement_owner;
create policy entitlement_epoch_read on dlkt_info_billing.notice_epoch for select to dlkt_billing_entitlement_owner using(true);
create policy entitlement_epoch_insert on dlkt_info_billing.notice_epoch for insert to dlkt_billing_entitlement_owner with check(true);
create policy entitlement_epoch_update on dlkt_info_billing.notice_epoch for update to dlkt_billing_entitlement_owner using(true) with check(true);

create function dlkt_info_billing.invalidate_notice_epoch() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
  insert into dlkt_info_billing.notice_epoch as e(account_id,epoch) values(new.account_id,1)
  on conflict(account_id) do update set epoch=e.epoch+1;
  return new;
end;
$$;
grant create on schema dlkt_info_billing to dlkt_billing_entitlement_owner;
alter function dlkt_info_billing.invalidate_notice_epoch() owner to dlkt_billing_entitlement_owner;
revoke create on schema dlkt_info_billing from dlkt_billing_entitlement_owner;
revoke all on function dlkt_info_billing.invalidate_notice_epoch() from public,anon,authenticated,service_role;
create trigger invalidate_notice_epoch after insert on dlkt_info_billing.event_notices
for each row execute function dlkt_info_billing.invalidate_notice_epoch();

-- Evidence is linked to an exact claim generation, fence and intake epoch.
-- A fixture can never become a real payment receipt.
create table dlkt_info_billing.entitlement_claim_context (
  account_id text not null,
  subscription_id text not null,
  generation bigint not null check(generation>0),
  fence bigint not null check(fence>0),
  epoch bigint not null check(epoch>=0),
  started_at bigint not null check(started_at>0),
  primary key(account_id,subscription_id),
  foreign key(account_id,subscription_id) references dlkt_info_billing.subscription_reconcile(account_id,subscription_id)
);
create table dlkt_info_billing.entitlement_fixture_candidates (
  account_id text not null,
  subscription_id text not null,
  generation bigint not null check(generation>0),
  fence bigint not null check(fence>0),
  epoch bigint not null check(epoch>=0),
  invoice_id text not null check(invoice_id ~ '^in_[A-Za-z0-9]{1,252}$'),
  source text generated always as ('synthetic_fixture'::text) stored,
  verified_at bigint not null,
  period_start bigint not null,
  period_end bigint not null,
  cancel_at bigint,
  valid_until bigint not null,
  primary key(account_id,subscription_id),
  foreign key(account_id,subscription_id) references dlkt_info_billing.subscription_reconcile(account_id,subscription_id),
  check(period_start>0 and period_start<=verified_at and verified_at<period_end),
  check(valid_until=least(period_end,verified_at+300,coalesce(cancel_at,period_end)) and valid_until>verified_at)
);
alter table dlkt_info_billing.entitlement_claim_context enable row level security;
alter table dlkt_info_billing.entitlement_fixture_candidates enable row level security;
revoke all on dlkt_info_billing.entitlement_claim_context,dlkt_info_billing.entitlement_fixture_candidates from public,anon,authenticated,service_role;
grant select,insert,update on dlkt_info_billing.entitlement_claim_context,dlkt_info_billing.entitlement_fixture_candidates to dlkt_billing_entitlement_owner;
create policy entitlement_context_read on dlkt_info_billing.entitlement_claim_context for select to dlkt_billing_entitlement_owner using(true);
create policy entitlement_context_insert on dlkt_info_billing.entitlement_claim_context for insert to dlkt_billing_entitlement_owner with check(true);
create policy entitlement_context_update on dlkt_info_billing.entitlement_claim_context for update to dlkt_billing_entitlement_owner using(true) with check(true);
create policy entitlement_fixture_read on dlkt_info_billing.entitlement_fixture_candidates for select to dlkt_billing_entitlement_owner using(true);
create policy entitlement_fixture_insert on dlkt_info_billing.entitlement_fixture_candidates for insert to dlkt_billing_entitlement_owner with check(true);
create policy entitlement_fixture_update on dlkt_info_billing.entitlement_fixture_candidates for update to dlkt_billing_entitlement_owner using(true) with check(true);

grant select on dlkt_info_billing.catalog_accounts,dlkt_info_billing.catalog_prices,dlkt_info_billing.customer_bindings,
dlkt_info_billing.subscription_bindings,dlkt_info_billing.subscription_reconcile,dlkt_info_billing.event_jobs,
dlkt_info_billing.checkout_intents to dlkt_billing_entitlement_owner;
create policy entitlement_account_read on dlkt_info_billing.catalog_accounts for select to dlkt_billing_entitlement_owner using(true);
create policy entitlement_price_read on dlkt_info_billing.catalog_prices for select to dlkt_billing_entitlement_owner using(true);
create policy entitlement_customer_read on dlkt_info_billing.customer_bindings for select to dlkt_billing_entitlement_owner using(true);
create policy entitlement_subscription_read on dlkt_info_billing.subscription_bindings for select to dlkt_billing_entitlement_owner using(true);
create policy entitlement_reconcile_read on dlkt_info_billing.subscription_reconcile for select to dlkt_billing_entitlement_owner using(true);
create policy entitlement_job_read on dlkt_info_billing.event_jobs for select to dlkt_billing_entitlement_owner using(true);
create policy entitlement_checkout_read on dlkt_info_billing.checkout_intents for select to dlkt_billing_entitlement_owner using(true);
grant execute on function dlkt_info_billing.claim_subscription(text),
dlkt_info_billing.record_subscription_observation(text,text,bigint,bigint,uuid,text,text,text,text)
to dlkt_billing_entitlement_owner;

-- The lab fixture role is separate from the actual reconciliation role.
-- No runtime route or production credential is authorized for this role.
create function dlkt_info_billing.claim_entitlement_fixture(p_account text)
returns table(account_id text,subscription_id text,customer_id text,owner_id uuid,item_id text,price_id text,
 generation bigint,fence bigint,lease_until timestamptz,epoch bigint,started_at bigint)
language plpgsql security definer set search_path=pg_catalog as $$
declare v record; v_epoch bigint; v_started bigint;
begin
  select * into v from dlkt_info_billing.claim_subscription(p_account);
  if not found then return; end if;
  select coalesce((select e.epoch from dlkt_info_billing.notice_epoch e where e.account_id=p_account),0) into v_epoch;
  v_started:=floor(extract(epoch from clock_timestamp()))::bigint;
  insert into dlkt_info_billing.entitlement_claim_context as c(account_id,subscription_id,generation,fence,epoch,started_at)
  values(v.account_id,v.subscription_id,v.generation,v.fence,v_epoch,v_started)
  on conflict on constraint entitlement_claim_context_pkey do update
  set generation=excluded.generation,fence=excluded.fence,epoch=excluded.epoch,started_at=excluded.started_at;
  return query select v.account_id,v.subscription_id,v.customer_id,v.owner_id,v.item_id,v.price_id,
    v.generation,v.fence,v.lease_until,v_epoch,v_started;
end;
$$;

-- This positive path exists exclusively to exercise a hypothetical authorized
-- payment in a disposable database. Never call it with live Stripe data.
-- Trusted fixture caller supplies normalized policy evidence, not browser data.
create function dlkt_info_billing.publish_entitlement_fixture(p_account text,p_subscription text,p_generation bigint,p_fence bigint,
  p_epoch bigint,p_owner uuid,p_customer text,p_item text,p_price text,p_product text,p_invoice text,
  p_verified bigint,p_start bigint,p_end bigint,p_cancel bigint,p_status text,p_paused boolean,p_funds boolean,p_risk text)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare v_context dlkt_info_billing.entitlement_claim_context%rowtype; v_now bigint; v_plan text; v_until bigint;
begin
  v_now:=floor(extract(epoch from clock_timestamp()))::bigint;
  if p_status is distinct from 'active' or p_paused is distinct from false
    or p_funds is distinct from true or p_risk is distinct from 'clear'
    or p_invoice is null or p_invoice !~ '^in_[A-Za-z0-9]{1,252}$'
    or p_verified is null or p_start is null or p_end is null or p_start<=0
    or p_start>p_verified or p_verified>v_now or p_end<=v_now
    or p_verified<=v_now-300 or (p_cancel is not null and p_cancel<=v_now) then return false; end if;
  select c.* into v_context from dlkt_info_billing.entitlement_claim_context c
    where c.account_id=p_account and c.subscription_id=p_subscription;
  if not found or v_context.generation is distinct from p_generation or v_context.fence is distinct from p_fence
    or v_context.epoch is distinct from p_epoch or p_verified<v_context.started_at then return false; end if;
  if coalesce((select e.epoch from dlkt_info_billing.notice_epoch e where e.account_id=p_account),0) is distinct from p_epoch
    or exists(select 1 from dlkt_info_billing.event_jobs j where j.account_id=p_account and j.state<>'routed') then return false; end if;
  select p.plan into v_plan from dlkt_info_billing.subscription_bindings s
    join dlkt_info_billing.customer_bindings c on c.account_id=s.account_id and c.customer_id=s.customer_id
    join dlkt_info_billing.catalog_accounts a on a.account_id=s.account_id
    join dlkt_info_billing.catalog_prices p on p.account_id=s.account_id and p.price_id=s.price_id
    join dlkt_info_billing.checkout_intents i on i.account_id=s.account_id and i.customer_id=s.customer_id and i.completed_subscription_id=s.subscription_id
    where s.account_id=p_account and s.subscription_id=p_subscription and s.customer_id=p_customer and c.owner_id=p_owner
      and s.item_id=p_item and s.price_id=p_price and a.product_id=p_product and a.live_mode=false
      and i.state='complete' and i.price_id=s.price_id;
  if not found or p_end-p_start>(case when v_plan='monthly' then 32 else 367 end)*86400 then return false; end if;
  v_until:=least(p_end,p_verified+300,coalesce(p_cancel,p_end));
  if v_until<=v_now then return false; end if;
  -- Existing reconciliation primitive locks the subscription and checks the
  -- live lease. The receipt and observed state commit or roll back together.
  if not dlkt_info_billing.record_subscription_observation(p_account,p_subscription,p_generation,p_fence,p_owner,p_customer,p_item,p_price,'active') then return false; end if;
  if coalesce((select e.epoch from dlkt_info_billing.notice_epoch e where e.account_id=p_account),0) is distinct from p_epoch
    or exists(select 1 from dlkt_info_billing.event_jobs j where j.account_id=p_account and j.state<>'routed')
    or v_until<=floor(extract(epoch from clock_timestamp()))::bigint then
    raise exception using errcode='40001',message='BILLING_FIXTURE_INVALIDATED';
  end if;
  insert into dlkt_info_billing.entitlement_fixture_candidates as e(account_id,subscription_id,generation,fence,epoch,invoice_id,
    verified_at,period_start,period_end,cancel_at,valid_until)
  values(p_account,p_subscription,p_generation,p_fence,p_epoch,p_invoice,p_verified,p_start,p_end,p_cancel,v_until)
  on conflict on constraint entitlement_fixture_candidates_pkey do update set generation=excluded.generation,fence=excluded.fence,
    epoch=excluded.epoch,invoice_id=excluded.invoice_id,verified_at=excluded.verified_at,period_start=excluded.period_start,
    period_end=excluded.period_end,cancel_at=excluded.cancel_at,valid_until=excluded.valid_until;
  return true;
end;
$$;

-- No token or access to imported user data is issued. Return a short-lived
-- sandbox candidate only if every revocation condition is currently satisfied.
create function dlkt_info_billing.read_entitlement_fixture(p_account text,p_owner uuid)
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
    and i.state='complete' and i.price_id=s.price_id
    and q.state='observed' and q.observed_status='active' and q.generation=e.generation and q.fence=e.fence
    and e.epoch=coalesce((select n.epoch from dlkt_info_billing.notice_epoch n where n.account_id=e.account_id),0)
    and not exists(select 1 from dlkt_info_billing.event_jobs j where j.account_id=e.account_id and j.state<>'routed')
    and e.period_start<=extract(epoch from clock_timestamp())
    and e.verified_at<=extract(epoch from clock_timestamp()) and e.valid_until>extract(epoch from clock_timestamp());
$$;
grant create on schema dlkt_info_billing to dlkt_billing_entitlement_owner;
alter function dlkt_info_billing.claim_entitlement_fixture(text) owner to dlkt_billing_entitlement_owner;
alter function dlkt_info_billing.publish_entitlement_fixture(text,text,bigint,bigint,bigint,uuid,text,text,text,text,text,bigint,bigint,bigint,bigint,text,boolean,boolean,text) owner to dlkt_billing_entitlement_owner;
alter function dlkt_info_billing.read_entitlement_fixture(text,uuid) owner to dlkt_billing_entitlement_owner;
revoke create on schema dlkt_info_billing from dlkt_billing_entitlement_owner;
revoke all on function dlkt_info_billing.claim_entitlement_fixture(text),
dlkt_info_billing.publish_entitlement_fixture(text,text,bigint,bigint,bigint,uuid,text,text,text,text,text,bigint,bigint,bigint,bigint,text,boolean,boolean,text),
dlkt_info_billing.read_entitlement_fixture(text,uuid)
from public,anon,authenticated,service_role,dlkt_billing_reconciler,dlkt_billing_entitlement_reader,dlkt_billing_evidence_fixture;
grant execute on function dlkt_info_billing.claim_entitlement_fixture(text),
dlkt_info_billing.publish_entitlement_fixture(text,text,bigint,bigint,bigint,uuid,text,text,text,text,text,bigint,bigint,bigint,bigint,text,boolean,boolean,text) to dlkt_billing_evidence_fixture;
grant execute on function dlkt_info_billing.read_entitlement_fixture(text,uuid) to dlkt_billing_entitlement_reader;
commit;
