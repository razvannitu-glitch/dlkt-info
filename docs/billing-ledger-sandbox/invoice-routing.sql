-- Isolated candidate only: no hosted migration or access grant.
begin;
create role dlkt_billing_invoice_router nologin noinherit nobypassrls;
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
commit;
