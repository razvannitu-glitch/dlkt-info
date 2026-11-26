-- Fresh synthetic account, no actual Stripe data.
insert into auth.users(id) values('00000000-0000-4000-8000-000000000017');
insert into dlkt_info_billing.catalog_accounts(account_id,product_id) values('acct_Risk','prod_Risk');
insert into dlkt_info_billing.catalog_prices(account_id,price_id,plan,amount_cents) values('acct_Risk','price_Risk','monthly',699);
insert into dlkt_info_billing.customer_bindings(account_id,customer_id,owner_id) values('acct_Risk','cus_Risk','00000000-0000-4000-8000-000000000017');
insert into dlkt_info_billing.subscription_bindings(account_id,customer_id,subscription_id,price_id,item_id) values('acct_Risk','cus_Risk','sub_Risk','price_Risk','si_Risk');
insert into dlkt_info_billing.subscription_reconcile(account_id,subscription_id) values('acct_Risk','sub_Risk');
insert into dlkt_info_billing.checkout_intents(intent_id,account_id,customer_id,price_id,created_at,expires_at,state,session_id,closed_at,completed_subscription_id)
values('20000000-0000-4000-8000-000000000017','acct_Risk','cus_Risk','price_Risk',date_trunc('second',clock_timestamp()),floor(extract(epoch from clock_timestamp()))::bigint+3600,'complete','cs_test_Risk',clock_timestamp(),'sub_Risk');
do $$
declare r text;t record;
begin
 foreach r in array array['anon','authenticated','service_role','dlkt_billing_worker','dlkt_billing_reconciler','dlkt_billing_invoice_router','dlkt_billing_risk_router'] loop
  for t in select c.oid,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='dlkt_info_billing' and c.relname in ('risk_charge_links','risk_notice_routes') loop
   if not t.relrowsecurity or has_table_privilege(r,t.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'Direct risk table access';end if;
  end loop;
  if r<>'dlkt_billing_risk_router' and has_function_privilege(r,'dlkt_info_billing.route_risk_notice(text,text,integer,text,text,text,text,text,uuid,text,text,text)','EXECUTE') then raise exception 'Untrusted risk router';end if;
 end loop;
end;
$$;
set role dlkt_billing_evidence_fixture;
do $$
declare x record;n bigint;
begin
 select * into strict x from dlkt_info_billing.claim_entitlement_fixture('acct_Risk');n:=x.started_at;
 if not dlkt_info_billing.publish_entitlement_fixture(x.account_id,x.subscription_id,x.generation,x.fence,x.epoch,x.owner_id,x.customer_id,x.item_id,x.price_id,'prod_Risk','in_RiskBefore',n,n-60,n+2592000,null,'active',false,true,'clear') then raise exception 'Initial fixture rejected';end if;
end;
$$;
reset role;
set role dlkt_billing_entitlement_reader;
do $$
begin if not exists(select 1 from dlkt_info_billing.read_entitlement_fixture('acct_Risk','00000000-0000-4000-8000-000000000017')) then raise exception 'Initial fixture missing';end if;end;
$$;
reset role;
set role dlkt_billing_queue_owner;
do $$
begin
 begin perform dlkt_info_billing.ingest_notice('acct_Risk','evt_OldDispute','charge.dispute.created','dp_Risk',901);raise exception 'Wrong dispute prefix accepted';exception when check_violation then null;end;
 perform dlkt_info_billing.ingest_notice('acct_Risk','evt_RiskRefund','charge.refunded','ch_Risk',900);
end;
$$;
reset role;
set role dlkt_billing_worker;
select * from dlkt_info_billing.claim_notice('acct_Risk');
reset role;
set role dlkt_billing_risk_router;
do $$
declare o uuid:='00000000-0000-4000-8000-000000000017';
begin
 if dlkt_info_billing.route_risk_notice('acct_Risk','evt_RiskRefund',2,'ch_Risk','ch_Risk','pi_Risk','in_Risk','sub_Risk',o,'cus_Risk','si_Risk','price_Risk') then raise exception 'Stale risk lease accepted';end if;
 if dlkt_info_billing.route_risk_notice('acct_Risk','evt_RiskRefund',1,'ch_Risk','ch_Other','pi_Risk','in_Risk','sub_Risk',o,'cus_Risk','si_Risk','price_Risk') then raise exception 'Foreign charge accepted';end if;
 if not dlkt_info_billing.route_risk_notice('acct_Risk','evt_RiskRefund',1,'ch_Risk','ch_Risk','pi_Risk','in_Risk','sub_Risk',o,'cus_Risk','si_Risk','price_Risk') then raise exception 'Valid risk route rejected';end if;
 if dlkt_info_billing.route_risk_notice('acct_Risk','evt_RiskRefund',1,'ch_Risk','ch_Risk','pi_Risk','in_Risk','sub_Risk',o,'cus_Risk','si_Risk','price_Risk') then raise exception 'Risk replay accepted';end if;
end;
$$;
reset role;
set role dlkt_billing_queue_owner;
select dlkt_info_billing.ingest_notice('acct_Risk','evt_RiskDispute','charge.dispute.created','du_Risk',800);
reset role;
set role dlkt_billing_worker;
select * from dlkt_info_billing.claim_notice('acct_Risk');
reset role;
set role dlkt_billing_risk_router;
do $$
declare o uuid:='00000000-0000-4000-8000-000000000017';
begin
 begin perform dlkt_info_billing.route_risk_notice('acct_Risk','evt_RiskDispute',1,'du_Risk','ch_Risk','pi_Risk','in_Conflicting','sub_Risk',o,'cus_Risk','si_Risk','price_Risk');raise exception 'Risk mapping rewritten';exception when check_violation then null;end;
 if not dlkt_info_billing.route_risk_notice('acct_Risk','evt_RiskDispute',1,'du_Risk','ch_Risk','pi_Risk','in_Risk','sub_Risk',o,'cus_Risk','si_Risk','price_Risk') then raise exception 'Late dispute rejected';end if;
end;
$$;
reset role;
set role dlkt_billing_evidence_fixture;
do $$
declare x record;n bigint;
begin
 select * into strict x from dlkt_info_billing.claim_entitlement_fixture('acct_Risk');n:=x.started_at;
 if x.generation<>3 then raise exception 'Risk generation not advanced';end if;
 if not dlkt_info_billing.publish_entitlement_fixture(x.account_id,x.subscription_id,x.generation,x.fence,x.epoch,x.owner_id,x.customer_id,x.item_id,x.price_id,'prod_Risk','in_RiskNew',n,n-60,n+2592000,null,'active',false,true,'clear') then raise exception 'Fresh synthetic fixture setup failed';end if;
end;
$$;
reset role;
set role dlkt_billing_entitlement_reader;
do $$
begin if exists(select 1 from dlkt_info_billing.read_entitlement_fixture('acct_Risk','00000000-0000-4000-8000-000000000017')) then raise exception 'New payment incorrectly cleared historical risk';end if;end;
$$;
reset role;
do $$
begin
 if exists(select 1 from dlkt_info_billing.invoice_links where account_id='acct_Risk' and invoice_id='in_Conflicting')
 or (select count(*) from dlkt_info_billing.risk_charge_links where account_id='acct_Risk')<>1
 or (select count(*) from dlkt_info_billing.risk_notice_routes where account_id='acct_Risk')<>2
 or exists(select 1 from dlkt_info_billing.subscription_reconcile where account_id='acct_Risk' and (funds_confirmed or risk_state<>'unknown'))
 then raise exception 'Risk receipt/rollback invariant';end if;
end;
$$;
select 'FINANCIAL_RISK_RECONCILIATION_OK' as result;
