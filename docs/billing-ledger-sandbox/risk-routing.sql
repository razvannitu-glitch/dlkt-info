-- Disposable laboratory only. Not applied to hosted integration or production.
begin;
-- The original ledger used dp_; the Stripe Dispute object uses du_.
alter table dlkt_info_billing.event_notices drop constraint event_notices_check;
alter table dlkt_info_billing.event_notices add constraint event_notices_object_type_check check(
 (event_type like 'checkout.session.%' and object_id ~ '^cs_test_[A-Za-z0-9]+$') or
 (event_type like 'customer.subscription.%' and object_id ~ '^sub_[A-Za-z0-9]+$') or
 (event_type like 'invoice.%' and object_id ~ '^in_[A-Za-z0-9]+$') or
 (event_type='charge.refunded' and object_id ~ '^ch_[A-Za-z0-9]+$') or
 (event_type='charge.dispute.created' and object_id ~ '^du_[A-Za-z0-9]+$') or
 (event_type='radar.early_fraud_warning.created' and object_id ~ '^issfr_[A-Za-z0-9]+$')
);
create role dlkt_billing_risk_router nologin noinherit nobypassrls;
grant usage on schema dlkt_info_billing to dlkt_billing_risk_router;
create table dlkt_info_billing.risk_charge_links(
 account_id text not null,charge_id text not null check(charge_id ~ '^ch_[A-Za-z0-9]{1,252}$'),
 payment_intent_id text not null check(payment_intent_id ~ '^pi_[A-Za-z0-9]{1,252}$'),invoice_id text not null,
 primary key(account_id,charge_id),unique(account_id,payment_intent_id),
 foreign key(account_id,invoice_id) references dlkt_info_billing.invoice_links(account_id,invoice_id)
);
create table dlkt_info_billing.risk_notice_routes(
 account_id text not null,event_id text not null,charge_id text not null,
 event_type text not null check(event_type in ('charge.refunded','charge.dispute.created','radar.early_fraud_warning.created')),
 generation bigint not null check(generation>0),recorded_at timestamptz not null default clock_timestamp(),
 primary key(account_id,event_id),
 foreign key(account_id,event_id) references dlkt_info_billing.event_notices(account_id,event_id),
 foreign key(account_id,charge_id) references dlkt_info_billing.risk_charge_links(account_id,charge_id)
);
create index risk_charge_invoice_idx on dlkt_info_billing.risk_charge_links(account_id,invoice_id);
create index invoice_link_subscription_idx on dlkt_info_billing.invoice_links(account_id,subscription_id);
alter table dlkt_info_billing.risk_charge_links enable row level security;
alter table dlkt_info_billing.risk_notice_routes enable row level security;
revoke all on dlkt_info_billing.risk_charge_links,dlkt_info_billing.risk_notice_routes from public,anon,authenticated,service_role,dlkt_billing_worker,dlkt_billing_reconciler,dlkt_billing_risk_router;
grant select,insert on dlkt_info_billing.risk_charge_links,dlkt_info_billing.risk_notice_routes to dlkt_billing_queue_owner;
create policy risk_link_read on dlkt_info_billing.risk_charge_links for select to dlkt_billing_queue_owner using(true);
create policy risk_link_insert on dlkt_info_billing.risk_charge_links for insert to dlkt_billing_queue_owner with check(true);
create policy risk_receipt_read on dlkt_info_billing.risk_notice_routes for select to dlkt_billing_queue_owner using(true);
create policy risk_receipt_insert on dlkt_info_billing.risk_notice_routes for insert to dlkt_billing_queue_owner with check(true);
grant select on dlkt_info_billing.risk_charge_links,dlkt_info_billing.invoice_links to dlkt_billing_entitlement_owner;
create policy risk_fixture_hold_read on dlkt_info_billing.risk_charge_links for select to dlkt_billing_entitlement_owner using(true);
create policy risk_fixture_invoice_read on dlkt_info_billing.invoice_links for select to dlkt_billing_entitlement_owner using(true);
grant execute on function dlkt_info_billing.read_invoice_binding(text,text) to dlkt_billing_risk_router;
-- Conservative persistent review hold. Even a newer synthetic paid invoice
-- cannot clear an unresolved historical risk. No automated clear function.
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
    and not exists(select 1 from dlkt_info_billing.risk_charge_links rc join dlkt_info_billing.invoice_links il on il.account_id=rc.account_id and il.invoice_id=rc.invoice_id where il.account_id=s.account_id and il.subscription_id=s.subscription_id)
    and i.state='complete' and i.price_id=s.price_id
    and q.state='observed' and q.observed_status='active' and q.generation=e.generation and q.fence=e.fence
    and e.epoch=coalesce((select n.epoch from dlkt_info_billing.notice_epoch n where n.account_id=e.account_id),0)
    and not exists(select 1 from dlkt_info_billing.event_jobs j where j.account_id=e.account_id and j.state<>'routed')
    and e.period_start<=extract(epoch from clock_timestamp())
    and e.verified_at<=extract(epoch from clock_timestamp()) and e.valid_until>extract(epoch from clock_timestamp());
$$;
create function dlkt_info_billing.route_risk_notice(
 p_account text,p_event text,p_attempt integer,p_object text,p_charge text,p_intent text,p_invoice text,p_subscription text,p_owner uuid,
 p_customer text,p_item text,p_price text)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare j dlkt_info_billing.event_jobs%rowtype;n dlkt_info_billing.event_notices%rowtype;g bigint;
begin
 select x.* into j from dlkt_info_billing.event_jobs x where x.account_id=p_account and x.event_id=p_event for update;
 if not found or j.state<>'leased' or j.attempt is distinct from p_attempt or j.lease_until<=clock_timestamp() then return false;end if;
 select x.* into strict n from dlkt_info_billing.event_notices x where x.account_id=p_account and x.event_id=p_event;
 if n.event_type not in ('charge.refunded','charge.dispute.created','radar.early_fraud_warning.created')
  or n.object_id is distinct from p_object or (n.event_type='charge.refunded' and n.object_id is distinct from p_charge)
  or p_charge is null or p_intent is null or p_invoice is null
  or p_charge !~ '^ch_[A-Za-z0-9]{1,252}$' or p_intent !~ '^pi_[A-Za-z0-9]{1,252}$' or p_invoice !~ '^in_[A-Za-z0-9]{1,252}$' then return false;end if;
 if not exists(select 1 from dlkt_info_billing.read_invoice_binding(p_account,p_subscription) b
  where b.owner_id=p_owner and b.customer_id=p_customer and b.item_id=p_item and b.price_id=p_price) then return false;end if;
 insert into dlkt_info_billing.invoice_links(account_id,invoice_id,subscription_id) values(p_account,p_invoice,p_subscription) on conflict do nothing;
 if not exists(select 1 from dlkt_info_billing.invoice_links l where l.account_id=p_account and l.invoice_id=p_invoice and l.subscription_id=p_subscription) then raise exception using errcode='23514',message='RISK_INVOICE_LINK_CONFLICT';end if;
 insert into dlkt_info_billing.risk_charge_links(account_id,charge_id,payment_intent_id,invoice_id) values(p_account,p_charge,p_intent,p_invoice) on conflict do nothing;
 if not exists(select 1 from dlkt_info_billing.risk_charge_links l where l.account_id=p_account and l.charge_id=p_charge and l.payment_intent_id=p_intent and l.invoice_id=p_invoice) then raise exception using errcode='23514',message='RISK_CHARGE_LINK_CONFLICT';end if;
 insert into dlkt_info_billing.subscription_reconcile as q(account_id,subscription_id) values(p_account,p_subscription)
 on conflict(account_id,subscription_id) do update set generation=q.generation+1,attempt=0,state='pending',
 available_at=clock_timestamp(),lease_until=null,observed_at=null,observed_status=null returning generation into g;
 insert into dlkt_info_billing.risk_notice_routes(account_id,event_id,charge_id,event_type,generation) values(p_account,p_event,p_charge,n.event_type,g);
 if not dlkt_info_billing.finish_notice(p_account,p_event,p_attempt,'routed') then raise exception using errcode='40001',message='RISK_ROUTE_LEASE_EXPIRED';end if;
 return true;
end;
$$;
grant create on schema dlkt_info_billing to dlkt_billing_queue_owner;
alter function dlkt_info_billing.route_risk_notice(text,text,integer,text,text,text,text,text,uuid,text,text,text) owner to dlkt_billing_queue_owner;
revoke create on schema dlkt_info_billing from dlkt_billing_queue_owner;
revoke all on function dlkt_info_billing.route_risk_notice(text,text,integer,text,text,text,text,text,uuid,text,text,text)
 from public,anon,authenticated,service_role,dlkt_billing_worker,dlkt_billing_reconciler,dlkt_billing_invoice_router,dlkt_billing_risk_router;
grant execute on function dlkt_info_billing.route_risk_notice(text,text,integer,text,text,text,text,text,uuid,text,text,text) to dlkt_billing_risk_router;
commit;
