-- Uses checkout completion fixture from checkout-test.sql; all data synthetic.
do $$
declare r text; f record;
begin
  if exists(select 1 from pg_roles where rolname='dlkt_billing_entitlement_owner' and (rolcanlogin or rolbypassrls or rolsuper)) then raise exception 'Unrestricted entitlement definer'; end if;
  if has_schema_privilege('dlkt_billing_entitlement_owner','dlkt_info_billing','CREATE') then raise exception 'Entitlement definer retained CREATE'; end if;
  foreach r in array array['anon','authenticated'] loop
    if has_schema_privilege(r,'dlkt_info_billing','USAGE') then raise exception 'Browser schema grant'; end if;
    for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='dlkt_info_billing' loop
      if has_function_privilege(r,f.oid,'EXECUTE') then raise exception 'Browser function grant'; end if;
    end loop;
  end loop;
  foreach r in array array['service_role','dlkt_billing_reconciler','dlkt_billing_entitlement_reader','dlkt_billing_evidence_fixture'] loop
    if has_table_privilege(r,'dlkt_info_billing.entitlement_fixture_candidates','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'Direct evidence table grant'; end if;
  end loop;
  if has_function_privilege('dlkt_billing_reconciler','dlkt_info_billing.publish_entitlement_fixture(text,text,bigint,bigint,bigint,uuid,text,text,text,text,text,bigint,bigint,bigint,bigint,text,boolean,boolean,text)','EXECUTE') then raise exception 'Actual reconciliation can publish synthetic grant'; end if;
end;
$$;
set role dlkt_billing_entitlement_reader;
do $$
begin
  if exists(select 1 from dlkt_info_billing.read_entitlement_fixture('acct_Checkout','00000000-0000-4000-8000-000000000004')) then raise exception 'Checkout completion alone authorized'; end if;
end;
$$;
reset role;
set role dlkt_billing_evidence_fixture;
do $$
declare x record; n bigint;
begin
  select * into strict x from dlkt_info_billing.claim_entitlement_fixture('acct_Checkout');
  n:=x.started_at;
  if x.subscription_id<>'sub_Complete' or x.epoch<>0 then raise exception 'Wrong entitlement claim'; end if;
  if dlkt_info_billing.publish_entitlement_fixture(x.account_id,x.subscription_id,x.generation,x.fence,x.epoch,x.owner_id,x.customer_id,x.item_id,x.price_id,'prod_Checkout','in_Fixture',n,n-60,n+2592000,null,'active',false,false,'unknown') then raise exception 'Unknown funds/risk accepted'; end if;
  if dlkt_info_billing.publish_entitlement_fixture(x.account_id,x.subscription_id,x.generation,x.fence,x.epoch,x.owner_id,x.customer_id,x.item_id,x.price_id,'prod_Checkout','in_Fixture',n,n-60,n+2592000,null,'past_due',false,true,'clear') then raise exception 'Past due accepted'; end if;
  if dlkt_info_billing.publish_entitlement_fixture(x.account_id,x.subscription_id,x.generation,x.fence+1,x.epoch,x.owner_id,x.customer_id,x.item_id,x.price_id,'prod_Checkout','in_Fixture',n,n-60,n+2592000,null,'active',false,true,'clear') then raise exception 'Wrong fence accepted'; end if;
  if dlkt_info_billing.publish_entitlement_fixture(x.account_id,x.subscription_id,x.generation,x.fence,x.epoch,x.owner_id,x.customer_id,x.item_id,'price_CheckoutYear','prod_Checkout','in_Fixture',n,n-60,n+2592000,null,'active',false,true,'clear') then raise exception 'Foreign price accepted'; end if;
  if not dlkt_info_billing.publish_entitlement_fixture(x.account_id,x.subscription_id,x.generation,x.fence,x.epoch,x.owner_id,x.customer_id,x.item_id,x.price_id,'prod_Checkout','in_Fixture',n,n-60,n+2592000,n+120,'active',false,true,'clear') then raise exception 'Synthetic eligible payment rejected'; end if;
  if dlkt_info_billing.publish_entitlement_fixture(x.account_id,x.subscription_id,x.generation,x.fence,x.epoch,x.owner_id,x.customer_id,x.item_id,x.price_id,'prod_Checkout','in_Fixture',n,n-60,n+2592000,null,'active',false,true,'clear') then raise exception 'Completed claim overwritten'; end if;
end;
$$;
reset role;
set role dlkt_billing_entitlement_reader;
do $$
declare x record;
begin
  select * into strict x from dlkt_info_billing.read_entitlement_fixture('acct_Checkout','00000000-0000-4000-8000-000000000004');
  if x.source<>'synthetic_fixture' or x.valid_until<>x.cancel_at or x.subscription_id<>'sub_Complete' then raise exception 'Wrong synthetic receipt'; end if;
  if exists(select 1 from dlkt_info_billing.read_entitlement_fixture('acct_Checkout','00000000-0000-4000-8000-000000000005')) then raise exception 'Cross-user entitlement'; end if;
  if exists(select 1 from dlkt_info_billing.read_entitlement_fixture('acct_Other','00000000-0000-4000-8000-000000000004')) then raise exception 'Cross-account entitlement'; end if;
end;
$$;
reset role;

-- A fresh notice invalidates before the worker routes it.
set role service_role;
select dlkt_info_billing.ingest_notice('acct_Checkout','evt_Invalidate','customer.subscription.updated','sub_Complete',900);
select dlkt_info_billing.ingest_notice('acct_Checkout','evt_Invalidate','customer.subscription.updated','sub_Complete',900);
reset role;
do $$
begin
  if (select epoch from dlkt_info_billing.notice_epoch where account_id='acct_Checkout')<>1 then raise exception 'Duplicate invalidation'; end if;
end;
$$;
set role dlkt_billing_entitlement_reader;
do $$
begin
  if exists(select 1 from dlkt_info_billing.read_entitlement_fixture('acct_Checkout','00000000-0000-4000-8000-000000000004')) then raise exception 'Pending notice did not invalidate'; end if;
end;
$$;
reset role;
set role dlkt_billing_worker;
select dlkt_info_billing.route_subscription_notice(account_id,event_id,attempt) from dlkt_info_billing.claim_notice('acct_Checkout');
reset role;
set role dlkt_billing_entitlement_reader;
do $$
begin
  if exists(select 1 from dlkt_info_billing.read_entitlement_fixture('acct_Checkout','00000000-0000-4000-8000-000000000004')) then raise exception 'Old generation revived'; end if;
end;
$$;
reset role;
set role dlkt_billing_evidence_fixture;
do $$
declare x record;n bigint;
begin
  select * into strict x from dlkt_info_billing.claim_entitlement_fixture('acct_Checkout');
  n:=x.started_at;
  if x.epoch<>1 or x.generation<>2 then raise exception 'Wrong fresh context'; end if;
  if not dlkt_info_billing.publish_entitlement_fixture(x.account_id,x.subscription_id,x.generation,x.fence,x.epoch,x.owner_id,x.customer_id,x.item_id,x.price_id,'prod_Checkout','in_NewFixture',n,n-60,n+2592000,null,'active',false,true,'clear') then raise exception 'Fresh fixture rejected'; end if;
end;
$$;
reset role;
set role dlkt_billing_entitlement_reader;
do $$
begin
  if not exists(select 1 from dlkt_info_billing.read_entitlement_fixture('acct_Checkout','00000000-0000-4000-8000-000000000004')) then raise exception 'Fresh entitlement missing'; end if;
end;
$$;
reset role;
-- Simulate passage of the 5-minute evidence lifetime using admin-only fixture changes.
update dlkt_info_billing.entitlement_fixture_candidates set verified_at=verified_at-600,period_start=period_start-600,valid_until=valid_until-600
where account_id='acct_Checkout';
set role dlkt_billing_entitlement_reader;
do $$
begin
  if exists(select 1 from dlkt_info_billing.read_entitlement_fixture('acct_Checkout','00000000-0000-4000-8000-000000000004')) then raise exception 'Stale evidence accepted'; end if;
end;
$$;
reset role;
-- Recreate the fresh fixture timestamp solely to isolate the deletion check.
update dlkt_info_billing.entitlement_fixture_candidates set verified_at=verified_at+600,period_start=period_start+600,valid_until=valid_until+600
where account_id='acct_Checkout';
delete from auth.users where id='00000000-0000-4000-8000-000000000004';
set role dlkt_billing_entitlement_reader;
do $$
begin
  if exists(select 1 from dlkt_info_billing.read_entitlement_fixture('acct_Checkout','00000000-0000-4000-8000-000000000004')) then raise exception 'Deleted user retained access'; end if;
end;
$$;
reset role;
select 'BILLING_ENTITLEMENT_FIXTURE_SQL_OK' as result;
