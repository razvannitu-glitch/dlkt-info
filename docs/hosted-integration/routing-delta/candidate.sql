-- Forward delta for isolated dlkt-info-integration ONLY. Not a production migration.
-- Derived from tested invoice/risk/checkout routing SQL; no fixture entitlement.
-- Apply atomically via hosted migration runner. No login activation or provider data.
do $$
begin
 if current_user<>'postgres'
 or (select count(*) from dlkt_info_runtime.instance)<>1
 or not exists(select 1 from dlkt_info_runtime.instance where singleton and project_ref='hziavqdhsqnihxuuxzhn' and environment='integration' and contract_version=1)
 or (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname like 'dlkt_info_%' and c.relkind='r')<>14
 or (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname like 'dlkt_info_%')<>38
 or (select count(*) from pg_roles where rolname like 'dlkt_rt_%')<>11
 or exists(select 1 from pg_roles where rolname like 'dlkt_rt_%' and rolcanlogin)
 or exists(select 1 from pg_stat_activity where usename like 'dlkt_rt_%')
 or exists(select 1 from auth.users) or exists(select 1 from auth.sessions)
 or exists(select 1 from dlkt_info_billing.event_notices) or exists(select 1 from dlkt_info_billing.event_jobs)
 or exists(select 1 from dlkt_info_billing.customer_bindings) or exists(select 1 from dlkt_info_billing.checkout_intents)
 or exists(select 1 from dlkt_info_billing.subscription_bindings) or exists(select 1 from dlkt_info_billing.subscription_reconcile)
 or (select count(*) from dlkt_info_billing.catalog_accounts)<>1
 or not exists(select 1 from dlkt_info_billing.catalog_accounts where account_id='acct_1Ug2Sh77EKtnzo3p' and product_id='prod_VhRhJqxfqwsphh' and live_mode=false)
 or (select count(*) from dlkt_info_billing.catalog_prices)<>2
 or not exists(select 1 from dlkt_info_billing.catalog_prices where account_id='acct_1Ug2Sh77EKtnzo3p' and price_id='price_1Ug2no77EKtnzo3pFonO3DoN' and amount_cents=699 and plan='monthly' and currency='eur')
 or not exists(select 1 from dlkt_info_billing.catalog_prices where account_id='acct_1Ug2Sh77EKtnzo3p' and price_id='price_1Ug2nq77EKtnzo3pu9VDFjZ7' and amount_cents=6900 and plan='annual' and currency='eur')
 or exists(select 1 from pg_roles where rolname=any(array['dlkt_billing_invoice_router','dlkt_billing_risk_router','dlkt_billing_checkout_router']))
 or not exists(select 1 from pg_constraint where conrelid='dlkt_info_billing.event_notices'::regclass and conname='event_notices_check' and pg_get_constraintdef(oid) like '%^dp_%')
 then raise exception 'ROUTING_DELTA_PRECONDITION';end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='dlkt_info_billing' and (p.proname like '%entitlement%' or p.proname=any(array['read_invoice_binding','route_invoice_notice','route_risk_notice','read_checkout_notice_binding','route_checkout_notice'])))
 or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='dlkt_info_billing' and (c.relname like '%entitlement_fixture%' or c.relname=any(array['invoice_links','invoice_notice_routes','risk_charge_links','risk_notice_routes','checkout_notice_routes']))) then raise exception 'Unexpected entitlement or routing object';end if;
end;
$$;
-- Temporary maintenance inheritance, restored before commit.
grant dlkt_billing_queue_owner to postgres with set true, inherit true;
grant dlkt_billing_checkout_owner to postgres with set true, inherit true;

create role dlkt_billing_invoice_router nologin noinherit nobypassrls nocreaterole nocreatedb noreplication password null;
grant dlkt_billing_invoice_router to postgres with set true, inherit false;
grant usage on schema dlkt_info_billing to dlkt_billing_invoice_router;
-- A historical invoice is permanently linked to its verified subscription.
-- Several events may concern one invoice; mapping identity cannot be replaced.
create table dlkt_info_billing.invoice_links(
 account_id text not null,
 invoice_id text not null check(invoice_id ~ '^in_[A-Za-z0-9]{1,252}$'),
 subscription_id text not null,
 primary key(account_id,invoice_id),
 foreign key(account_id,subscription_id) references dlkt_info_billing.subscription_bindings(account_id,subscription_id)
);
create table dlkt_info_billing.invoice_notice_routes(
 account_id text not null,
 event_id text not null,
 invoice_id text not null,
 generation bigint not null check(generation>0),
 routed_at timestamptz not null default clock_timestamp(),
 primary key(account_id,event_id),
 foreign key(account_id,event_id) references dlkt_info_billing.event_notices(account_id,event_id),
 foreign key(account_id,invoice_id) references dlkt_info_billing.invoice_links(account_id,invoice_id)
);
alter table dlkt_info_billing.invoice_links enable row level security;
alter table dlkt_info_billing.invoice_notice_routes enable row level security;
revoke all on dlkt_info_billing.invoice_links,dlkt_info_billing.invoice_notice_routes
from public,anon,authenticated,service_role,dlkt_billing_worker,dlkt_billing_reconciler,dlkt_billing_invoice_router;
grant select,insert on dlkt_info_billing.invoice_links,dlkt_info_billing.invoice_notice_routes to dlkt_billing_queue_owner;
create policy invoice_link_read on dlkt_info_billing.invoice_links for select to dlkt_billing_queue_owner using(true);
create policy invoice_link_insert on dlkt_info_billing.invoice_links for insert to dlkt_billing_queue_owner with check(true);
create policy invoice_route_read on dlkt_info_billing.invoice_notice_routes for select to dlkt_billing_queue_owner using(true);
create policy invoice_route_insert on dlkt_info_billing.invoice_notice_routes for insert to dlkt_billing_queue_owner with check(true);
grant select on dlkt_info_billing.catalog_accounts to dlkt_billing_queue_owner;
create policy invoice_route_account_read on dlkt_info_billing.catalog_accounts for select to dlkt_billing_queue_owner using(true);

create function dlkt_info_billing.read_invoice_binding(p_account text,p_subscription text)
returns table(account_id text,owner_id uuid,customer_id text,subscription_id text,item_id text,price_id text,live_mode boolean)
language sql security definer set search_path=pg_catalog as $$
 select s.account_id,c.owner_id,s.customer_id,s.subscription_id,s.item_id,s.price_id,a.live_mode
 from dlkt_info_billing.subscription_bindings s
 join dlkt_info_billing.customer_bindings c on c.account_id=s.account_id and c.customer_id=s.customer_id
 join dlkt_info_billing.catalog_accounts a on a.account_id=s.account_id
 where s.account_id=p_account and s.subscription_id=p_subscription and c.owner_id is not null and a.live_mode=false;
$$;

-- Restricted trusted router only. The provider invoice and current subscription
-- must be read and checked by the server before this call; PostgreSQL cannot
-- independently authenticate a caller's Stripe response.
create function dlkt_info_billing.route_invoice_notice(
 p_account text,p_event text,p_attempt integer,p_invoice text,p_subscription text,p_owner uuid,
 p_customer text,p_item text,p_price text)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare v_job dlkt_info_billing.event_jobs%rowtype; v_notice dlkt_info_billing.event_notices%rowtype; v_generation bigint;
begin
 select j.* into v_job from dlkt_info_billing.event_jobs j where j.account_id=p_account and j.event_id=p_event for update;
 if not found or v_job.state<>'leased' or v_job.attempt is distinct from p_attempt or v_job.lease_until<=clock_timestamp() then return false;end if;
 select n.* into strict v_notice from dlkt_info_billing.event_notices n where n.account_id=p_account and n.event_id=p_event;
 if v_notice.event_type not in ('invoice.paid','invoice.payment_failed') or v_notice.object_id is distinct from p_invoice then return false;end if;
 if not exists(select 1 from dlkt_info_billing.read_invoice_binding(p_account,p_subscription) b
  where b.owner_id=p_owner and b.customer_id=p_customer and b.item_id=p_item and b.price_id=p_price) then return false;end if;
 insert into dlkt_info_billing.invoice_links(account_id,invoice_id,subscription_id) values(p_account,p_invoice,p_subscription)
 on conflict(account_id,invoice_id) do nothing;
 if not exists(select 1 from dlkt_info_billing.invoice_links l where l.account_id=p_account and l.invoice_id=p_invoice and l.subscription_id=p_subscription) then return false;end if;
 insert into dlkt_info_billing.subscription_reconcile as q(account_id,subscription_id) values(p_account,p_subscription)
 on conflict(account_id,subscription_id) do update set generation=q.generation+1,attempt=0,state='pending',
 available_at=clock_timestamp(),lease_until=null,observed_at=null,observed_status=null returning generation into v_generation;
 insert into dlkt_info_billing.invoice_notice_routes(account_id,event_id,invoice_id,generation) values(p_account,p_event,p_invoice,v_generation);
 if not dlkt_info_billing.finish_notice(p_account,p_event,p_attempt,'routed') then
  raise exception using errcode='40001',message='INVOICE_ROUTE_LEASE_EXPIRED';
 end if;
 return true;
end;
$$;
grant create on schema dlkt_info_billing to dlkt_billing_queue_owner;
alter function dlkt_info_billing.read_invoice_binding(text,text) owner to dlkt_billing_queue_owner;
alter function dlkt_info_billing.route_invoice_notice(text,text,integer,text,text,uuid,text,text,text) owner to dlkt_billing_queue_owner;
revoke create on schema dlkt_info_billing from dlkt_billing_queue_owner;
revoke all on function dlkt_info_billing.read_invoice_binding(text,text),dlkt_info_billing.route_invoice_notice(text,text,integer,text,text,uuid,text,text,text)
from public,anon,authenticated,service_role,dlkt_billing_worker,dlkt_billing_reconciler,dlkt_billing_invoice_router;
grant execute on function dlkt_info_billing.read_invoice_binding(text,text),dlkt_info_billing.route_invoice_notice(text,text,integer,text,text,uuid,text,text,text)
to dlkt_billing_invoice_router;

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
create role dlkt_billing_risk_router nologin noinherit nobypassrls nocreaterole nocreatedb noreplication password null;
grant dlkt_billing_risk_router to postgres with set true, inherit false;
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
grant execute on function dlkt_info_billing.read_invoice_binding(text,text) to dlkt_billing_risk_router;
-- Persistent risk evidence only. No entitlement fixture or clearance function.
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

create role dlkt_billing_checkout_router nologin noinherit nobypassrls nocreaterole nocreatedb noreplication password null;
grant dlkt_billing_checkout_router to postgres with set true, inherit false;
grant usage on schema dlkt_info_billing to dlkt_billing_checkout_router;
grant select on dlkt_info_billing.checkout_intents to dlkt_billing_queue_owner;
create policy checkout_notice_queue_read on dlkt_info_billing.checkout_intents for select to dlkt_billing_queue_owner using(true);
grant execute on function dlkt_info_billing.finish_checkout(text,uuid,uuid,text,text,text,bigint,text,text,text,text) to dlkt_billing_queue_owner;
create table dlkt_info_billing.checkout_notice_routes(
 account_id text not null,event_id text not null,intent_id uuid not null references dlkt_info_billing.checkout_intents(intent_id),
 session_id text not null check(session_id ~ '^cs_test_[A-Za-z0-9]{1,247}$'),
 terminal_state text not null check(terminal_state in ('complete','expired')),
 generation bigint check(generation is null or generation>0),recorded_at timestamptz not null default clock_timestamp(),
 primary key(account_id,event_id),
 foreign key(account_id,event_id) references dlkt_info_billing.event_notices(account_id,event_id),
 check((terminal_state='expired' and generation is null) or (terminal_state='complete' and generation is not null))
);
alter table dlkt_info_billing.checkout_notice_routes enable row level security;
revoke all on dlkt_info_billing.checkout_notice_routes from public,anon,authenticated,service_role,dlkt_billing_worker,dlkt_billing_checkout_router,dlkt_billing_checkout_api,dlkt_billing_checkout_recovery;
grant select,insert on dlkt_info_billing.checkout_notice_routes to dlkt_billing_queue_owner;
create policy checkout_notice_receipt_read on dlkt_info_billing.checkout_notice_routes for select to dlkt_billing_queue_owner using(true);
create policy checkout_notice_receipt_insert on dlkt_info_billing.checkout_notice_routes for insert to dlkt_billing_queue_owner with check(true);

create function dlkt_info_billing.read_checkout_notice_binding(p_account text,p_event text,p_attempt integer,p_intent uuid,p_session text,p_customer text)
returns table(account_id text,intent_id uuid,owner_id uuid,customer_id text,price_id text,created_at bigint,expires_at bigint,session_id text,state text,completed_subscription_id text,live_mode boolean)
language sql security definer set search_path=pg_catalog as $$
 select i.account_id,i.intent_id,c.owner_id,i.customer_id,i.price_id,extract(epoch from i.created_at)::bigint,i.expires_at,i.session_id,i.state,i.completed_subscription_id,a.live_mode
 from dlkt_info_billing.event_jobs j join dlkt_info_billing.event_notices n using(account_id,event_id)
 join dlkt_info_billing.checkout_intents i on i.account_id=j.account_id
 join dlkt_info_billing.customer_bindings c on c.account_id=i.account_id and c.customer_id=i.customer_id
 join dlkt_info_billing.catalog_accounts a on a.account_id=i.account_id
 where j.account_id=p_account and j.event_id=p_event and j.state='leased' and j.attempt=p_attempt and j.lease_until>clock_timestamp()
  and n.event_type in ('checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','checkout.session.expired')
  and n.object_id=p_session and i.intent_id=p_intent and i.customer_id=p_customer and c.owner_id is not null and a.live_mode=false
  and (i.session_id=p_session or (i.state='reserved' and i.session_id is null));
$$;
-- Trusted router calls only after authoritative Stripe reads. Terminal state
-- follows current provider observation, not event arrival order. Closure
-- holds still deny access; in-flight terminal recording is permitted.
create function dlkt_info_billing.route_checkout_notice(p_account text,p_event text,p_attempt integer,p_intent uuid,p_owner uuid,
 p_customer text,p_price text,p_session text,p_expiry bigint,p_status text,p_payment_status text,p_subscription text,p_item text)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare j dlkt_info_billing.event_jobs%rowtype;g bigint;
begin
 select x.* into j from dlkt_info_billing.event_jobs x where x.account_id=p_account and x.event_id=p_event for update;
 if not found or j.state<>'leased' or j.attempt is distinct from p_attempt or j.lease_until<=clock_timestamp() then return false;end if;
 if not exists(select 1 from dlkt_info_billing.read_checkout_notice_binding(p_account,p_event,p_attempt,p_intent,p_session,p_customer) b
 where b.owner_id=p_owner and b.price_id=p_price and b.expires_at=p_expiry) then return false;end if;
 if not dlkt_info_billing.finish_checkout(p_account,p_intent,p_owner,p_customer,p_price,p_session,p_expiry,p_status,p_payment_status,p_subscription,p_item) then return false;end if;
 if p_status='complete' then
  update dlkt_info_billing.subscription_reconcile q set generation=q.generation+1,attempt=0,state='pending',available_at=clock_timestamp(),
   lease_until=null,observed_at=null,observed_status=null where q.account_id=p_account and q.subscription_id=p_subscription returning generation into strict g;
 end if;
 insert into dlkt_info_billing.checkout_notice_routes(account_id,event_id,intent_id,session_id,terminal_state,generation) values(p_account,p_event,p_intent,p_session,p_status,g);
 if not dlkt_info_billing.finish_notice(p_account,p_event,p_attempt,'routed') then raise exception using errcode='40001',message='CHECKOUT_NOTICE_LEASE_EXPIRED';end if;
 return true;
end;
$$;
grant create on schema dlkt_info_billing to dlkt_billing_queue_owner;
alter function dlkt_info_billing.read_checkout_notice_binding(text,text,integer,uuid,text,text) owner to dlkt_billing_queue_owner;
alter function dlkt_info_billing.route_checkout_notice(text,text,integer,uuid,uuid,text,text,text,bigint,text,text,text,text) owner to dlkt_billing_queue_owner;
revoke create on schema dlkt_info_billing from dlkt_billing_queue_owner;
revoke all on function dlkt_info_billing.read_checkout_notice_binding(text,text,integer,uuid,text,text),dlkt_info_billing.route_checkout_notice(text,text,integer,uuid,uuid,text,text,text,bigint,text,text,text,text)
from public,anon,authenticated,service_role,dlkt_billing_worker,dlkt_billing_checkout_api,dlkt_billing_checkout_recovery,dlkt_billing_checkout_router;
grant execute on function dlkt_info_billing.read_checkout_notice_binding(text,text,integer,uuid,text,text),dlkt_info_billing.route_checkout_notice(text,text,integer,uuid,uuid,text,text,text,bigint,text,text,text,text) to dlkt_billing_checkout_router;

-- No generic API role, router or existing runtime role receives table access.
revoke all on dlkt_info_billing.invoice_links,dlkt_info_billing.invoice_notice_routes,dlkt_info_billing.risk_charge_links,dlkt_info_billing.risk_notice_routes,dlkt_info_billing.checkout_notice_routes from public,anon,authenticated,authenticator,service_role;
revoke all on function dlkt_info_billing.read_invoice_binding(text,text),
dlkt_info_billing.route_invoice_notice(text,text,integer,text,text,uuid,text,text,text),
dlkt_info_billing.route_risk_notice(text,text,integer,text,text,text,text,text,uuid,text,text,text),
dlkt_info_billing.read_checkout_notice_binding(text,text,integer,uuid,text,text),
dlkt_info_billing.route_checkout_notice(text,text,integer,uuid,uuid,text,text,text,bigint,text,text,text,text) from public,anon,authenticated,authenticator,service_role;
grant dlkt_billing_queue_owner to postgres with set true, inherit false;
grant dlkt_billing_checkout_owner to postgres with set true, inherit false;
do $$
declare t record;f record;r text;allowed text[];actual text;
begin
 if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname like 'dlkt_info_%' and c.relkind='r')<>19
 or (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname like 'dlkt_info_%')<>43 then raise exception 'Routing object count mismatch';end if;
 if exists(select 1 from pg_roles where rolname like 'dlkt_billing_%' and (rolcanlogin or rolsuper or rolbypassrls or rolcreaterole or rolcreatedb or rolreplication))
 or exists(select 1 from pg_roles where rolname like 'dlkt_rt_%' and rolcanlogin)
 or exists(select 1 from pg_auth_members m join pg_roles r on r.oid=m.roleid join pg_roles u on u.oid=m.member where r.rolname like 'dlkt_billing_%' and u.rolname='postgres' and m.inherit_option)
 or has_schema_privilege('dlkt_billing_queue_owner','dlkt_info_billing','CREATE') then raise exception 'Unsafe role or maintenance inheritance';end if;
 foreach r in array array['anon','authenticated','service_role','authenticator'] loop
  if has_schema_privilege(r,'dlkt_info_billing','USAGE') then raise exception 'Broad billing schema access';end if;
  for t in select c.oid,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='dlkt_info_billing' and c.relkind='r' loop
   if not t.relrowsecurity or has_table_privilege(r,t.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or has_any_column_privilege(r,t.oid,'SELECT,INSERT,UPDATE,REFERENCES') then raise exception 'Broad table access';end if;
  end loop;
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='dlkt_info_billing' loop
   if has_function_privilege(r,f.oid,'EXECUTE') then raise exception 'Broad function access';end if;
  end loop;
 end loop;
 for r in select rolname from pg_roles where (rolname like 'dlkt_billing_%' or rolname like 'dlkt_rt_%') and rolname<>'dlkt_billing_queue_owner' loop
  for t in select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='dlkt_info_billing' and c.relname=any(array['invoice_links','invoice_notice_routes','risk_charge_links','risk_notice_routes','checkout_notice_routes']) loop
   if has_table_privilege(r,t.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or has_any_column_privilege(r,t.oid,'SELECT,INSERT,UPDATE,REFERENCES') then raise exception 'Direct routing table privilege: %',r;end if;
  end loop;
  for f in select p.oid,p.proname,p.prosecdef,p.proconfig,pg_get_userbyid(p.proowner) as owner from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='dlkt_info_billing' and p.proname=any(array['read_invoice_binding','route_invoice_notice','route_risk_notice','read_checkout_notice_binding','route_checkout_notice']) loop
   allowed:=case f.proname
    when 'read_invoice_binding' then array['dlkt_billing_invoice_router','dlkt_billing_risk_router']
    when 'route_invoice_notice' then array['dlkt_billing_invoice_router']
    when 'route_risk_notice' then array['dlkt_billing_risk_router']
    when 'read_checkout_notice_binding' then array['dlkt_billing_checkout_router']
    when 'route_checkout_notice' then array['dlkt_billing_checkout_router']
   end;
   if f.owner<>'dlkt_billing_queue_owner' or not f.prosecdef or f.proconfig is distinct from array['search_path=pg_catalog'] or has_function_privilege(r,f.oid,'EXECUTE') is distinct from (r=any(allowed)) then raise exception 'Routing function ACL mismatch: % / %',r,f.proname;end if;
  end loop;
 end loop;
 foreach r in array array['dlkt_billing_invoice_router','dlkt_billing_risk_router','dlkt_billing_checkout_router'] loop
  if has_function_privilege(r,'dlkt_info_billing.finish_notice(text,text,integer,text)','EXECUTE')
   or has_function_privilege(r,'dlkt_info_billing.finish_checkout(text,uuid,uuid,text,text,text,bigint,text,text,text,text)','EXECUTE')
   or has_function_privilege(r,'dlkt_info_billing.ingest_notice(text,text,text,text,bigint)','EXECUTE')
   or exists(select 1 from pg_auth_members m join pg_roles u on u.oid=m.member where u.rolname=r) then raise exception 'Router bypass';end if;
 end loop;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='dlkt_info_billing' and p.proname like '%entitlement%')
 or exists(select 1 from auth.users) or exists(select 1 from dlkt_info_billing.event_notices) then raise exception 'Unexpected fixture or data';end if;
end;
$$;
