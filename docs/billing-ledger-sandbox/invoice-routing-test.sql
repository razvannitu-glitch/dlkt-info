-- Synthetic only: use distinct account and owners.
insert into auth.users(id) values ('00000000-0000-4000-8000-000000000015'),('00000000-0000-4000-8000-000000000016');
insert into dlkt_info_billing.catalog_accounts(account_id,product_id) values('acct_InvoiceRoute','prod_InvoiceRoute');
insert into dlkt_info_billing.catalog_prices(account_id,price_id,plan,amount_cents) values('acct_InvoiceRoute','price_InvoiceRoute','monthly',699);
insert into dlkt_info_billing.customer_bindings(account_id,customer_id,owner_id) values
 ('acct_InvoiceRoute','cus_InvoiceRoute','00000000-0000-4000-8000-000000000015'),
 ('acct_InvoiceRoute','cus_InvoiceOther','00000000-0000-4000-8000-000000000016');
insert into dlkt_info_billing.subscription_bindings(account_id,customer_id,subscription_id,price_id,item_id) values
 ('acct_InvoiceRoute','cus_InvoiceRoute','sub_InvoiceRoute','price_InvoiceRoute','si_InvoiceRoute'),
 ('acct_InvoiceRoute','cus_InvoiceOther','sub_InvoiceOther','price_InvoiceRoute','si_InvoiceOther');
do $$
declare r text;t record;
begin
 foreach r in array array['anon','authenticated','service_role','dlkt_billing_worker','dlkt_billing_reconciler','dlkt_billing_invoice_router'] loop
  for t in select c.oid,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='dlkt_info_billing' and c.relname in ('invoice_links','invoice_notice_routes') loop
   if not t.relrowsecurity or has_table_privilege(r,t.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or has_any_column_privilege(r,t.oid,'SELECT,INSERT,UPDATE,REFERENCES') then raise exception 'Direct invoice routing table access';end if;
  end loop;
  if r<>'dlkt_billing_invoice_router' and (has_function_privilege(r,'dlkt_info_billing.read_invoice_binding(text,text)','EXECUTE') or has_function_privilege(r,'dlkt_info_billing.route_invoice_notice(text,text,integer,text,text,uuid,text,text,text)','EXECUTE')) then raise exception 'Untrusted invoice router';end if;
 end loop;
 if has_function_privilege('dlkt_billing_invoice_router','dlkt_info_billing.finish_notice(text,text,integer,text)','EXECUTE') then raise exception 'Router bypass';end if;
end;
$$;
set role dlkt_billing_queue_owner;
select dlkt_info_billing.ingest_notice('acct_InvoiceRoute','evt_InvoiceOne','invoice.paid','in_InvoiceRoute',900);
reset role;
set role dlkt_billing_worker;
select * from dlkt_info_billing.claim_notice('acct_InvoiceRoute');
reset role;
set role dlkt_billing_invoice_router;
do $$
declare o uuid:='00000000-0000-4000-8000-000000000015'; x record;
begin
 select * into strict x from dlkt_info_billing.read_invoice_binding('acct_InvoiceRoute','sub_InvoiceRoute');
 if x.owner_id<>o or x.customer_id<>'cus_InvoiceRoute' or x.live_mode then raise exception 'Bad binding';end if;
 if dlkt_info_billing.route_invoice_notice('acct_InvoiceRoute','evt_InvoiceOne',2,'in_InvoiceRoute','sub_InvoiceRoute',o,'cus_InvoiceRoute','si_InvoiceRoute','price_InvoiceRoute') then raise exception 'Stale event attempt';end if;
 if dlkt_info_billing.route_invoice_notice('acct_InvoiceRoute','evt_InvoiceOne',1,'in_Wrong','sub_InvoiceRoute',o,'cus_InvoiceRoute','si_InvoiceRoute','price_InvoiceRoute') then raise exception 'Substituted invoice';end if;
 if dlkt_info_billing.route_invoice_notice('acct_InvoiceRoute','evt_InvoiceOne',1,'in_InvoiceRoute','sub_InvoiceRoute','00000000-0000-4000-8000-000000000016','cus_InvoiceRoute','si_InvoiceRoute','price_InvoiceRoute') then raise exception 'Foreign owner';end if;
 if dlkt_info_billing.route_invoice_notice('acct_InvoiceRoute','evt_InvoiceOne',1,'in_InvoiceRoute','sub_InvoiceRoute',o,'cus_InvoiceRoute','si_InvoiceOther','price_InvoiceRoute') then raise exception 'Foreign item';end if;
 if not dlkt_info_billing.route_invoice_notice('acct_InvoiceRoute','evt_InvoiceOne',1,'in_InvoiceRoute','sub_InvoiceRoute',o,'cus_InvoiceRoute','si_InvoiceRoute','price_InvoiceRoute') then raise exception 'Valid invoice route rejected';end if;
 if dlkt_info_billing.route_invoice_notice('acct_InvoiceRoute','evt_InvoiceOne',1,'in_InvoiceRoute','sub_InvoiceRoute',o,'cus_InvoiceRoute','si_InvoiceRoute','price_InvoiceRoute') then raise exception 'Duplicate route';end if;
end;
$$;
reset role;
set role dlkt_billing_reconciler;
select * from dlkt_info_billing.claim_subscription('acct_InvoiceRoute');
reset role;
set role dlkt_billing_queue_owner;
select dlkt_info_billing.ingest_notice('acct_InvoiceRoute','evt_InvoiceTwo','invoice.payment_failed','in_InvoiceRoute',800);
reset role;
set role dlkt_billing_worker;
select * from dlkt_info_billing.claim_notice('acct_InvoiceRoute');
reset role;
set role dlkt_billing_invoice_router;
do $$
declare o uuid:='00000000-0000-4000-8000-000000000015';
begin
 if dlkt_info_billing.route_invoice_notice('acct_InvoiceRoute','evt_InvoiceTwo',1,'in_InvoiceRoute','sub_InvoiceOther','00000000-0000-4000-8000-000000000016','cus_InvoiceOther','si_InvoiceOther','price_InvoiceRoute') then raise exception 'Immutable invoice mapping replaced';end if;
 if not dlkt_info_billing.route_invoice_notice('acct_InvoiceRoute','evt_InvoiceTwo',1,'in_InvoiceRoute','sub_InvoiceRoute',o,'cus_InvoiceRoute','si_InvoiceRoute','price_InvoiceRoute') then raise exception 'Late invoice route rejected';end if;
end;
$$;
reset role;
set role dlkt_billing_reconciler;
do $$
declare o uuid:='00000000-0000-4000-8000-000000000015';x record;
begin
 if dlkt_info_billing.record_subscription_observation('acct_InvoiceRoute','sub_InvoiceRoute',1,1,o,'cus_InvoiceRoute','si_InvoiceRoute','price_InvoiceRoute','active') then raise exception 'Old observation accepted after invoice event';end if;
 select * into strict x from dlkt_info_billing.claim_subscription('acct_InvoiceRoute');
 if x.generation<>2 or x.fence<>2 then raise exception 'New generation/fence missing';end if;
end;
$$;
reset role;
do $$
begin
 if (select count(*) from dlkt_info_billing.invoice_links where account_id='acct_InvoiceRoute')<>1
 or (select count(*) from dlkt_info_billing.invoice_notice_routes where account_id='acct_InvoiceRoute')<>2
 or exists(select 1 from dlkt_info_billing.subscription_reconcile where account_id='acct_InvoiceRoute' and (funds_confirmed or risk_state<>'unknown')) then raise exception 'Invoice route receipt or policy failure';end if;
end;
$$;
select 'INVOICE_RECONCILIATION_ROUTE_OK' as result;
