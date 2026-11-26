-- Disposable laboratory only; never replay as an existing hosted migration.
begin;
create role dlkt_billing_checkout_router nologin noinherit nobypassrls;
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
commit;
