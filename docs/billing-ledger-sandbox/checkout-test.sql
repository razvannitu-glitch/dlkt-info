-- Runs only after earlier disposable ledger/queue/reconciliation tests.
insert into auth.users(id) values ('00000000-0000-4000-8000-000000000004'),('00000000-0000-4000-8000-000000000005'),('00000000-0000-4000-8000-000000000006'),('00000000-0000-4000-8000-000000000007');
insert into dlkt_info_billing.catalog_accounts(account_id,product_id) values('acct_Checkout','prod_Checkout');
insert into dlkt_info_billing.catalog_prices(account_id,price_id,plan,amount_cents) values
('acct_Checkout','price_CheckoutMonth','monthly',699),('acct_Checkout','price_CheckoutYear','annual',6900);
set role service_role;
insert into dlkt_info_billing.customer_bindings(account_id,customer_id,owner_id) values
('acct_Checkout','cus_Complete','00000000-0000-4000-8000-000000000004'),
('acct_Checkout','cus_Expire','00000000-0000-4000-8000-000000000005'),
('acct_Checkout','cus_Deleted','00000000-0000-4000-8000-000000000006'),
('acct_Checkout','cus_Race','00000000-0000-4000-8000-000000000007');
reset role;
do $$
declare r text; f record;
begin
  if exists(select 1 from pg_roles where rolname='dlkt_billing_checkout_owner' and (rolsuper or rolbypassrls or rolcanlogin)) then raise exception 'Unrestricted checkout definer'; end if;
  if has_schema_privilege('dlkt_billing_checkout_owner','dlkt_info_billing','CREATE') then raise exception 'Definer retained CREATE'; end if;
  foreach r in array array['anon','authenticated'] loop
    if has_schema_privilege(r,'dlkt_info_billing','USAGE') then raise exception 'Browser schema access'; end if;
    for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='dlkt_info_billing' loop
      if has_function_privilege(r,f.oid,'EXECUTE') then raise exception 'Browser callable billing function'; end if;
    end loop;
  end loop;
  if has_any_column_privilege('service_role','dlkt_info_billing.checkout_intents','INSERT') or has_any_column_privilege('service_role','dlkt_info_billing.subscription_bindings','INSERT') then raise exception 'Direct billing write bypass'; end if;
  if has_function_privilege('dlkt_billing_checkout_api','dlkt_info_billing.finish_checkout(text,uuid,uuid,text,text,text,bigint,text,text,text,text)','EXECUTE') then raise exception 'API can complete checkout'; end if;
  if has_function_privilege('dlkt_billing_checkout_recovery','dlkt_info_billing.reserve_checkout(text,uuid,text,uuid)','EXECUTE') then raise exception 'Recovery can start new purchase'; end if;
end;
$$;
set role dlkt_billing_checkout_api;
do $$
declare x record;y record;
o uuid:='00000000-0000-4000-8000-000000000004';i uuid:='20000000-0000-4000-8000-000000000004';
begin
  select * into strict x from dlkt_info_billing.reserve_checkout('acct_Checkout',o,'monthly',i);
  if x.intent_id<>i or x.customer_id<>'cus_Complete' or x.owner_id<>o or x.price_id<>'price_CheckoutMonth' or x.expires_at<>x.created_at+3600 then raise exception 'Wrong reservation'; end if;
  select * into strict y from dlkt_info_billing.reserve_checkout('acct_Checkout',o,'monthly','30000000-0000-4000-8000-000000000004');
  if y.intent_id<>i or y.expires_at<>x.expires_at then raise exception 'Duplicate intent created'; end if;
  if exists(select 1 from dlkt_info_billing.reserve_checkout('acct_Checkout',o,'annual','30000000-0000-4000-8000-000000000004')) then raise exception 'Plan swap accepted'; end if;
  if dlkt_info_billing.attach_checkout('acct_Checkout',i,o,'cus_Expire','price_CheckoutMonth','cs_test_Complete',x.expires_at) then raise exception 'Foreign customer attachment'; end if;
  if dlkt_info_billing.attach_checkout('acct_Checkout',i,o,'cus_Complete','price_CheckoutYear','cs_test_Complete',x.expires_at) then raise exception 'Foreign price attachment'; end if;
  if dlkt_info_billing.attach_checkout('acct_Checkout',i,o,'cus_Complete','price_CheckoutMonth','cs_live_Complete',x.expires_at) then raise exception 'Live session attached'; end if;
  if not dlkt_info_billing.attach_checkout('acct_Checkout',i,o,'cus_Complete','price_CheckoutMonth','cs_test_Complete',x.expires_at) then raise exception 'Valid attachment failed'; end if;
  if not dlkt_info_billing.attach_checkout('acct_Checkout',i,o,'cus_Complete','price_CheckoutMonth','cs_test_Complete',x.expires_at) then raise exception 'Idempotent attachment failed'; end if;
  if dlkt_info_billing.attach_checkout('acct_Checkout',i,o,'cus_Complete','price_CheckoutMonth','cs_test_Another',x.expires_at) then raise exception 'Session rebind accepted'; end if;
  begin
    update dlkt_info_billing.checkout_intents set closed_at=clock_timestamp() where intent_id=i;
    raise exception 'Raw checkout update accepted';
  exception when insufficient_privilege then null;
  end;
end;
$$;
select * from dlkt_info_billing.reserve_checkout('acct_Checkout','00000000-0000-4000-8000-000000000005','annual','20000000-0000-4000-8000-000000000005');
select * from dlkt_info_billing.reserve_checkout('acct_Checkout','00000000-0000-4000-8000-000000000006','monthly','20000000-0000-4000-8000-000000000006');
reset role;
set role dlkt_billing_checkout_recovery;
do $$
declare x record; y record;
begin
  select * into strict x from dlkt_info_billing.read_checkout('acct_Checkout','20000000-0000-4000-8000-000000000004');
  if x.session_id<>'cs_test_Complete' or x.state<>'attached' then raise exception 'Persisted attachment missing'; end if;
  if dlkt_info_billing.finish_checkout(x.account_id,x.intent_id,x.owner_id,x.customer_id,x.price_id,x.session_id,x.expires_at,'complete','unpaid','sub_Complete','si_Complete') then raise exception 'Unpaid completion accepted'; end if;
  if dlkt_info_billing.finish_checkout(x.account_id,x.intent_id,x.owner_id,x.customer_id,x.price_id,'cs_test_Wrong',x.expires_at,'complete','paid','sub_Complete','si_Complete') then raise exception 'Wrong session accepted'; end if;
  if not dlkt_info_billing.finish_checkout(x.account_id,x.intent_id,x.owner_id,x.customer_id,x.price_id,x.session_id,x.expires_at,'complete','paid','sub_Complete','si_Complete') then raise exception 'Valid completion failed'; end if;
  if not dlkt_info_billing.finish_checkout(x.account_id,x.intent_id,x.owner_id,x.customer_id,x.price_id,x.session_id,x.expires_at,'complete','paid','sub_Complete','si_Complete') then raise exception 'Completion replay failed'; end if;
  if dlkt_info_billing.finish_checkout(x.account_id,x.intent_id,x.owner_id,x.customer_id,x.price_id,x.session_id,x.expires_at,'complete','paid','sub_Complete','si_Wrong') then raise exception 'Replay with different item accepted'; end if;
  select * into strict y from dlkt_info_billing.read_checkout('acct_Checkout','20000000-0000-4000-8000-000000000005');
  if y.session_id is not null or y.state<>'reserved' then raise exception 'Crash recovery fixture invalid'; end if;
  if dlkt_info_billing.finish_checkout(y.account_id,y.intent_id,y.owner_id,y.customer_id,y.price_id,'cs_test_Complete',y.expires_at,'complete','paid','sub_Conflict','si_Conflict') then raise exception 'Foreign session reuse accepted'; end if;
  if dlkt_info_billing.finish_checkout(y.account_id,y.intent_id,y.owner_id,y.customer_id,y.price_id,'cs_test_Expire',y.expires_at,'expired','paid',null,null) then raise exception 'Paid session expired'; end if;
  if not dlkt_info_billing.finish_checkout(y.account_id,y.intent_id,y.owner_id,y.customer_id,y.price_id,'cs_test_Expire',y.expires_at,'expired','unpaid',null,null) then raise exception 'Lost response recovery failed'; end if;
  if dlkt_info_billing.finish_checkout(y.account_id,y.intent_id,y.owner_id,y.customer_id,y.price_id,'cs_test_Expire',y.expires_at,'complete','paid','sub_Other','si_Other') then raise exception 'Terminal state overwritten'; end if;
end;
$$;
reset role;
do $$
begin
  if not exists(select 1 from dlkt_info_billing.checkout_intents where customer_id='cus_Complete' and state='complete' and completed_subscription_id='sub_Complete') then raise exception 'Complete row missing'; end if;
  if not exists(select 1 from dlkt_info_billing.subscription_reconcile where account_id='acct_Checkout' and subscription_id='sub_Complete' and state='pending' and generation=1 and funds_confirmed=false and risk_state='unknown') then raise exception 'Non-authorizing reconciliation missing'; end if;
  if exists(select 1 from dlkt_info_billing.subscription_bindings where account_id='acct_Checkout' and subscription_id='sub_Conflict') then raise exception 'Failed terminal transaction left binding'; end if;
  if exists(select 1 from dlkt_info_billing.subscription_reconcile where account_id='acct_Checkout' and subscription_id='sub_Conflict') then raise exception 'Failed terminal transaction left job'; end if;
  if not exists(select 1 from dlkt_info_billing.checkout_intents where customer_id='cus_Expire' and state='expired') then raise exception 'Expired row missing'; end if;
end;
$$;
set role dlkt_billing_checkout_api;
do $$
begin
  if exists(select 1 from dlkt_info_billing.reserve_checkout('acct_Checkout','00000000-0000-4000-8000-000000000005','annual','30000000-0000-4000-8000-000000000005')) then raise exception 'Expired purchase automatically replaced'; end if;
  if exists(select 1 from dlkt_info_billing.reserve_checkout('acct_Checkout','00000000-0000-4000-8000-000000000004','monthly','30000000-0000-4000-8000-000000000004')) then raise exception 'Existing subscription duplicated'; end if;
end;
$$;
reset role;
delete from auth.users where id='00000000-0000-4000-8000-000000000006';
set role dlkt_billing_checkout_recovery;
do $$
begin
  if exists(select 1 from dlkt_info_billing.read_checkout('acct_Checkout','20000000-0000-4000-8000-000000000006')) then raise exception 'Deleted owner recovery exposed'; end if;
end;
$$;
reset role;
select 'BILLING_CHECKOUT_LIFECYCLE_SQL_OK' as result;
