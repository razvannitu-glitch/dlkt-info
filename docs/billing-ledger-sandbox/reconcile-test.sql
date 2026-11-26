-- Synthetic fixture; runs after baseline and queue tests.
-- The previous baseline deleted owner 1, so use owner 2 and its existing account A binding.
insert into dlkt_info_billing.catalog_accounts(account_id,product_id) values('acct_Reconcile','prod_Reconcile');
insert into dlkt_info_billing.catalog_prices(account_id,price_id,plan,amount_cents) values('acct_Reconcile','price_Reconcile','monthly',699);
set role service_role;
insert into dlkt_info_billing.customer_bindings(account_id,customer_id,owner_id)
values('acct_Reconcile','cus_Reconcile','00000000-0000-4000-8000-000000000002');
insert into dlkt_info_billing.subscription_bindings(account_id,customer_id,subscription_id,price_id,item_id)
values('acct_Reconcile','cus_Reconcile','sub_Reconcile','price_Reconcile','si_Reconcile');
select dlkt_info_billing.ingest_notice('acct_Reconcile','evt_First','customer.subscription.updated','sub_Reconcile',500);
reset role;
do $$
declare r text; f record;
begin
  if not (select relrowsecurity from pg_class where oid='dlkt_info_billing.subscription_reconcile'::regclass) then raise exception 'Reconciliation RLS disabled'; end if;
  if exists(select 1 from pg_roles where rolname='dlkt_billing_reconcile_owner' and (rolsuper or rolbypassrls or rolcanlogin)) then raise exception 'Unrestricted definer'; end if;
  if has_schema_privilege('dlkt_billing_reconcile_owner','dlkt_info_billing','CREATE') then raise exception 'Definer retained CREATE'; end if;
  foreach r in array array['anon','authenticated'] loop
    if has_schema_privilege(r,'dlkt_info_billing','USAGE') then raise exception 'Browser schema access'; end if;
    for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='dlkt_info_billing' loop
      if has_function_privilege(r,f.oid,'EXECUTE') then raise exception 'Browser callable function'; end if;
    end loop;
  end loop;
  foreach r in array array['service_role','dlkt_billing_worker','dlkt_billing_reconciler'] loop
    if has_table_privilege(r,'dlkt_info_billing.subscription_reconcile','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_any_column_privilege(r,'dlkt_info_billing.subscription_reconcile','SELECT,INSERT,UPDATE,REFERENCES') then raise exception 'Direct reconciliation access'; end if;
  end loop;
  if has_function_privilege('dlkt_billing_worker','dlkt_info_billing.finish_notice(text,text,integer,text)','EXECUTE') then raise exception 'Old routing bypass retained'; end if;
  if has_function_privilege('dlkt_billing_worker','dlkt_info_billing.claim_subscription(text)','EXECUTE') then raise exception 'Router can reconcile'; end if;
  if has_function_privilege('dlkt_billing_reconciler','dlkt_info_billing.route_subscription_notice(text,text,integer)','EXECUTE') then raise exception 'Reconciler can route'; end if;
end;
$$;
set role dlkt_billing_worker;
do $$
declare v record;
begin
  select * into strict v from dlkt_info_billing.claim_notice('acct_Reconcile');
  if v.event_id<>'evt_First' or v.attempt<>1 then raise exception 'Wrong first route'; end if;
  if dlkt_info_billing.route_subscription_notice('acct_Reconcile','evt_First',2) then raise exception 'Wrong event fence accepted'; end if;
  if not dlkt_info_billing.route_subscription_notice('acct_Reconcile','evt_First',1) then raise exception 'Valid route rejected'; end if;
  if dlkt_info_billing.route_subscription_notice('acct_Reconcile','evt_First',1) then raise exception 'Duplicate route accepted'; end if;
end;
$$;
reset role;
set role dlkt_billing_reconciler;
do $$
declare v record;
begin
  select * into strict v from dlkt_info_billing.claim_subscription('acct_Reconcile');
  if v.generation<>1 or v.fence<>1 or v.owner_id<>'00000000-0000-4000-8000-000000000002'::uuid
    or v.customer_id<>'cus_Reconcile' or v.item_id<>'si_Reconcile' or v.price_id<>'price_Reconcile' then raise exception 'Incorrect server binding'; end if;
  if exists(select 1 from dlkt_info_billing.claim_subscription('acct_Reconcile')) then raise exception 'Simultaneous lease accepted'; end if;
end;
$$;
reset role;

-- Older event creation time arrives later: request another authoritative read.
set role service_role;
select dlkt_info_billing.ingest_notice('acct_Reconcile','evt_Second','customer.subscription.deleted','sub_Reconcile',400);
reset role;
set role dlkt_billing_worker;
do $$
declare v record;
begin
  select * into strict v from dlkt_info_billing.claim_notice('acct_Reconcile');
  if not dlkt_info_billing.route_subscription_notice('acct_Reconcile',v.event_id,v.attempt) then raise exception 'Late notice not routed'; end if;
end;
$$;
reset role;
set role dlkt_billing_reconciler;
do $$
declare v record; o uuid:='00000000-0000-4000-8000-000000000002';
begin
  if dlkt_info_billing.record_subscription_observation('acct_Reconcile','sub_Reconcile',1,1,o,'cus_Reconcile','si_Reconcile','price_Reconcile','active') then raise exception 'Superseded generation committed'; end if;
  select * into strict v from dlkt_info_billing.claim_subscription('acct_Reconcile');
  if v.generation<>2 or v.fence<>2 then raise exception 'New generation or fence wrong'; end if;
  if dlkt_info_billing.record_subscription_observation('acct_Reconcile','sub_Reconcile',2,2,o,'cus_Foreign','si_Reconcile','price_Reconcile','active') then raise exception 'Foreign customer accepted'; end if;
  if dlkt_info_billing.record_subscription_observation('acct_Reconcile','sub_Reconcile',2,2,o,'cus_Reconcile','si_Foreign','price_Reconcile','active') then raise exception 'Foreign item accepted'; end if;
  if dlkt_info_billing.record_subscription_observation('acct_Reconcile','sub_Reconcile',2,2,o,'cus_Reconcile','si_Reconcile','price_Foreign','active') then raise exception 'Foreign price accepted'; end if;
  if dlkt_info_billing.record_subscription_observation('acct_Reconcile','sub_Reconcile',2,2,'00000000-0000-4000-8000-000000000001','cus_Reconcile','si_Reconcile','price_Reconcile','active') then raise exception 'Foreign owner accepted'; end if;
  if not dlkt_info_billing.record_subscription_observation('acct_Reconcile','sub_Reconcile',2,2,o,'cus_Reconcile','si_Reconcile','price_Reconcile','canceled') then raise exception 'Fresh observation rejected'; end if;
  if dlkt_info_billing.record_subscription_observation('acct_Reconcile','sub_Reconcile',2,2,o,'cus_Reconcile','si_Reconcile','price_Reconcile','active') then raise exception 'Terminal observation overwritten'; end if;
end;
$$;
reset role;
do $$
begin
  if not exists(select 1 from dlkt_info_billing.subscription_reconcile where account_id='acct_Reconcile' and generation=2 and state='observed' and observed_status='canceled' and funds_confirmed=false and risk_state='unknown') then raise exception 'Observation not fail closed'; end if;
end;
$$;

-- Invoice routing without verified provider linkage cannot succeed or use a guessed subscription.
set role service_role;
select dlkt_info_billing.ingest_notice('acct_Reconcile','evt_Invoice','invoice.paid','in_Reconcile',600);
reset role;
set role dlkt_billing_worker;
do $$
declare v record;
begin
  select * into strict v from dlkt_info_billing.claim_notice('acct_Reconcile');
  if dlkt_info_billing.route_subscription_notice('acct_Reconcile',v.event_id,v.attempt) then raise exception 'Unsupported invoice mapped'; end if;
  begin
    perform dlkt_info_billing.fail_notice('acct_Reconcile',v.event_id,v.attempt,'routed');
    raise exception 'Routing via failure accepted';
  exception when invalid_parameter_value then null;
  end;
  if not dlkt_info_billing.fail_notice('acct_Reconcile',v.event_id,v.attempt,'permanent_failure') then raise exception 'Failure not persisted'; end if;
end;
$$;
reset role;

set role service_role;
select dlkt_info_billing.ingest_notice('acct_Reconcile','evt_Third','customer.subscription.updated','sub_Reconcile',700);
reset role;
set role dlkt_billing_worker;
select dlkt_info_billing.route_subscription_notice(account_id,event_id,attempt) from dlkt_info_billing.claim_notice('acct_Reconcile');
reset role;
set role dlkt_billing_reconciler;
do $$
declare v record;
begin
  select * into strict v from dlkt_info_billing.claim_subscription('acct_Reconcile');
  if v.generation<>3 or v.fence<>3 then raise exception 'Third generation incorrect'; end if;
end;
$$;
reset role;
-- Expire the synthetic lease without sleeping.
update dlkt_info_billing.subscription_reconcile set lease_until=clock_timestamp()-interval '1 second' where account_id='acct_Reconcile';
set role dlkt_billing_reconciler;
do $$
declare v record; o uuid:='00000000-0000-4000-8000-000000000002';
begin
  if dlkt_info_billing.record_subscription_observation('acct_Reconcile','sub_Reconcile',3,3,o,'cus_Reconcile','si_Reconcile','price_Reconcile','active') then raise exception 'Expired fence accepted'; end if;
  select * into strict v from dlkt_info_billing.claim_subscription('acct_Reconcile');
  if v.generation<>3 or v.fence<>4 then raise exception 'Lease reacquisition incorrect'; end if;
  if dlkt_info_billing.fail_subscription('acct_Reconcile','sub_Reconcile',3,3,'retry') then raise exception 'Expired worker failure accepted'; end if;
  if not dlkt_info_billing.fail_subscription('acct_Reconcile','sub_Reconcile',3,4,'retry') then raise exception 'Retry rejected'; end if;
  if exists(select 1 from dlkt_info_billing.claim_subscription('acct_Reconcile')) then raise exception 'Retry delay bypassed'; end if;
end;
$$;
reset role;
update dlkt_info_billing.subscription_reconcile set available_at=clock_timestamp()-interval '1 second' where account_id='acct_Reconcile';
set role dlkt_billing_reconciler;
do $$
declare v record;
begin
  select * into strict v from dlkt_info_billing.claim_subscription('acct_Reconcile');
  if v.fence<>5 then raise exception 'Retry fence incorrect'; end if;
end;
$$;
reset role;
-- Separate synthetic account for parallel claims, before removing owner 2.
insert into dlkt_info_billing.catalog_accounts(account_id,product_id) values('acct_ReconcileRace','prod_ReconcileRace');
insert into dlkt_info_billing.catalog_prices(account_id,price_id,plan,amount_cents) values('acct_ReconcileRace','price_ReconcileRace','annual',6900);
-- Independent owner avoids interference with the deletion test.
insert into auth.users(id) values('00000000-0000-4000-8000-000000000003');
set role service_role;
insert into dlkt_info_billing.customer_bindings(account_id,customer_id,owner_id)
values('acct_ReconcileRace','cus_ReconcileRace','00000000-0000-4000-8000-000000000003');
insert into dlkt_info_billing.subscription_bindings(account_id,customer_id,subscription_id,price_id,item_id)
values('acct_ReconcileRace','cus_ReconcileRace','sub_ReconcileRace','price_ReconcileRace','si_ReconcileRace');
select dlkt_info_billing.ingest_notice('acct_ReconcileRace','evt_RouteRace','customer.subscription.updated','sub_ReconcileRace',800);
reset role;
set role dlkt_billing_worker;
select dlkt_info_billing.route_subscription_notice(account_id,event_id,attempt) from dlkt_info_billing.claim_notice('acct_ReconcileRace');
reset role;
delete from auth.users where id='00000000-0000-4000-8000-000000000002';
set role dlkt_billing_reconciler;
do $$
begin
  if dlkt_info_billing.record_subscription_observation('acct_Reconcile','sub_Reconcile',3,5,'00000000-0000-4000-8000-000000000002','cus_Reconcile','si_Reconcile','price_Reconcile','active') then raise exception 'Deleted owner accepted'; end if;
end;
$$;
reset role;
select 'BILLING_RECONCILIATION_ISOLATED_SQL_OK' as result;
