-- Isolated checkout event routing assertions, all data synthetic.
insert into auth.users(id) values('00000000-0000-4000-8000-000000000020'),('00000000-0000-4000-8000-000000000021');
insert into dlkt_info_billing.catalog_accounts(account_id,product_id) values('acct_CheckoutNotice','prod_CheckoutNotice');
insert into dlkt_info_billing.catalog_prices(account_id,price_id,plan,amount_cents) values('acct_CheckoutNotice','price_CheckoutNotice','monthly',699);
insert into dlkt_info_billing.customer_bindings(account_id,customer_id,owner_id) values
 ('acct_CheckoutNotice','cus_NoticePaid','00000000-0000-4000-8000-000000000020'),
 ('acct_CheckoutNotice','cus_NoticeExpired','00000000-0000-4000-8000-000000000021');
set role dlkt_billing_checkout_api;
select * from dlkt_info_billing.reserve_checkout('acct_CheckoutNotice','00000000-0000-4000-8000-000000000020','monthly','20000000-0000-4000-8000-000000000020');
select * from dlkt_info_billing.reserve_checkout('acct_CheckoutNotice','00000000-0000-4000-8000-000000000021','monthly','20000000-0000-4000-8000-000000000021');
reset role;
do $$
declare r text;
begin
 foreach r in array array['anon','authenticated','service_role','dlkt_billing_worker','dlkt_billing_checkout_api','dlkt_billing_checkout_recovery','dlkt_billing_checkout_router'] loop
  if has_table_privilege(r,'dlkt_info_billing.checkout_notice_routes','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'Direct checkout receipt access';end if;
  if r<>'dlkt_billing_checkout_router' and has_function_privilege(r,'dlkt_info_billing.route_checkout_notice(text,text,integer,uuid,uuid,text,text,text,bigint,text,text,text,text)','EXECUTE') then raise exception 'Unauthorized router';end if;
 end loop;
 if has_function_privilege('dlkt_billing_checkout_router','dlkt_info_billing.finish_checkout(text,uuid,uuid,text,text,text,bigint,text,text,text,text)','EXECUTE') then raise exception 'Checkout lease bypass';end if;
end;
$$;
set role dlkt_billing_queue_owner;
select dlkt_info_billing.ingest_notice('acct_CheckoutNotice','evt_NoticePaid','checkout.session.completed','cs_test_NoticePaid',1000);
reset role;
set role dlkt_billing_worker;
select * from dlkt_info_billing.claim_notice('acct_CheckoutNotice');
reset role;
set role dlkt_billing_checkout_router;
do $$
declare i uuid:='20000000-0000-4000-8000-000000000020';o uuid:='00000000-0000-4000-8000-000000000020';b record;
begin
 select * into strict b from dlkt_info_billing.read_checkout_notice_binding('acct_CheckoutNotice','evt_NoticePaid',1,i,'cs_test_NoticePaid','cus_NoticePaid');
 if b.state<>'reserved' or b.session_id is not null then raise exception 'Crash recovery binding absent';end if;
 if exists(select 1 from dlkt_info_billing.read_checkout_notice_binding('acct_CheckoutNotice','evt_NoticePaid',1,i,'cs_test_Wrong','cus_NoticePaid')) then raise exception 'Foreign session accepted';end if;
 if dlkt_info_billing.route_checkout_notice('acct_CheckoutNotice','evt_NoticePaid',2,i,o,'cus_NoticePaid','price_CheckoutNotice','cs_test_NoticePaid',b.expires_at,'complete','paid','sub_NoticePaid','si_NoticePaid') then raise exception 'Stale attempt accepted';end if;
 if dlkt_info_billing.route_checkout_notice('acct_CheckoutNotice','evt_NoticePaid',1,i,'00000000-0000-4000-8000-000000000021','cus_NoticePaid','price_CheckoutNotice','cs_test_NoticePaid',b.expires_at,'complete','paid','sub_NoticePaid','si_NoticePaid') then raise exception 'Foreign owner accepted';end if;
 if dlkt_info_billing.route_checkout_notice('acct_CheckoutNotice','evt_NoticePaid',1,i,o,'cus_NoticePaid','price_CheckoutNotice','cs_test_NoticePaid',b.expires_at,'complete','unpaid','sub_NoticePaid','si_NoticePaid') then raise exception 'Unpaid completion accepted';end if;
 if not dlkt_info_billing.route_checkout_notice('acct_CheckoutNotice','evt_NoticePaid',1,i,o,'cus_NoticePaid','price_CheckoutNotice','cs_test_NoticePaid',b.expires_at,'complete','paid','sub_NoticePaid','si_NoticePaid') then raise exception 'Terminal route rejected';end if;
 if dlkt_info_billing.route_checkout_notice('acct_CheckoutNotice','evt_NoticePaid',1,i,o,'cus_NoticePaid','price_CheckoutNotice','cs_test_NoticePaid',b.expires_at,'complete','paid','sub_NoticePaid','si_NoticePaid') then raise exception 'Replay accepted';end if;
end;
$$;
reset role;
set role dlkt_billing_queue_owner;
select dlkt_info_billing.ingest_notice('acct_CheckoutNotice','evt_NoticeLate','checkout.session.async_payment_failed','cs_test_NoticePaid',900);
reset role;
set role dlkt_billing_worker;
select * from dlkt_info_billing.claim_notice('acct_CheckoutNotice');
reset role;
set role dlkt_billing_checkout_router;
do $$
declare i uuid:='20000000-0000-4000-8000-000000000020';o uuid:='00000000-0000-4000-8000-000000000020';b record;
begin
 select * into strict b from dlkt_info_billing.read_checkout_notice_binding('acct_CheckoutNotice','evt_NoticeLate',1,i,'cs_test_NoticePaid','cus_NoticePaid');
 if b.state<>'complete' then raise exception 'Terminal readback failed';end if;
 if dlkt_info_billing.route_checkout_notice('acct_CheckoutNotice','evt_NoticeLate',1,i,o,'cus_NoticePaid','price_CheckoutNotice','cs_test_NoticePaid',b.expires_at,'expired','unpaid',null,null) then raise exception 'Terminal state reversed';end if;
 if not dlkt_info_billing.route_checkout_notice('acct_CheckoutNotice','evt_NoticeLate',1,i,o,'cus_NoticePaid','price_CheckoutNotice','cs_test_NoticePaid',b.expires_at,'complete','paid','sub_NoticePaid','si_NoticePaid') then raise exception 'Late consistent terminal observation rejected';end if;
end;
$$;
reset role;
set role dlkt_billing_queue_owner;
select dlkt_info_billing.ingest_notice('acct_CheckoutNotice','evt_NoticeExpired','checkout.session.expired','cs_test_NoticeExpired',1100);
reset role;
set role dlkt_billing_worker;
select * from dlkt_info_billing.claim_notice('acct_CheckoutNotice');
reset role;
-- Simulate expiry of the worker lease before any terminal mutation.
update dlkt_info_billing.event_jobs set lease_until=clock_timestamp()-interval '1 second' where account_id='acct_CheckoutNotice' and event_id='evt_NoticeExpired';
set role dlkt_billing_checkout_router;
do $$
begin
 if dlkt_info_billing.route_checkout_notice('acct_CheckoutNotice','evt_NoticeExpired',1,'20000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000021','cus_NoticeExpired','price_CheckoutNotice','cs_test_NoticeExpired',1,'expired','unpaid',null,null) then raise exception 'Expired lease accepted';end if;
end;
$$;
reset role;
set role dlkt_billing_worker;
select * from dlkt_info_billing.claim_notice('acct_CheckoutNotice');
reset role;
set role dlkt_billing_checkout_router;
do $$
declare i uuid:='20000000-0000-4000-8000-000000000021';o uuid:='00000000-0000-4000-8000-000000000021';b record;
begin
 select * into strict b from dlkt_info_billing.read_checkout_notice_binding('acct_CheckoutNotice','evt_NoticeExpired',2,i,'cs_test_NoticeExpired','cus_NoticeExpired');
 if not dlkt_info_billing.route_checkout_notice('acct_CheckoutNotice','evt_NoticeExpired',2,i,o,'cus_NoticeExpired','price_CheckoutNotice','cs_test_NoticeExpired',b.expires_at,'expired','unpaid',null,null) then raise exception 'Verified expiry rejected';end if;
end;
$$;
reset role;
do $$
begin
 if (select count(*) from dlkt_info_billing.checkout_notice_routes where account_id='acct_CheckoutNotice')<>3
 or (select count(*) from dlkt_info_billing.subscription_bindings where account_id='acct_CheckoutNotice')<>1
 or not exists(select 1 from dlkt_info_billing.subscription_reconcile where account_id='acct_CheckoutNotice' and generation=3 and funds_confirmed=false and risk_state='unknown')
 or not exists(select 1 from dlkt_info_billing.checkout_intents where account_id='acct_CheckoutNotice' and customer_id='cus_NoticeExpired' and state='expired')
 or exists(select 1 from dlkt_info_billing.entitlement_fixture_candidates where account_id='acct_CheckoutNotice')
 then raise exception 'Checkout terminal invariants failed';end if;
end;
$$;
select 'CHECKOUT_NOTICE_ROUTING_OK' as result;
