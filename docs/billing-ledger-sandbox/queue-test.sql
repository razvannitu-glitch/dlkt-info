-- Only after baseline ledger assertions and queue.sql. No real Stripe events.
do $$
declare r text; f record;
begin
  if not (select relrowsecurity from pg_class where oid='dlkt_info_billing.event_jobs'::regclass) then raise exception 'Queue RLS disabled'; end if;
  if exists(select 1 from pg_roles where rolname='dlkt_billing_queue_owner' and (rolsuper or rolbypassrls or rolcanlogin)) then raise exception 'Definer has excess privileges'; end if;
  if has_schema_privilege('dlkt_billing_queue_owner','dlkt_info_billing','CREATE') then raise exception 'Definer retained CREATE'; end if;
  foreach r in array array['anon','authenticated'] loop
    if has_schema_privilege(r,'dlkt_info_billing','USAGE') then raise exception 'Browser schema grant'; end if;
    for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='dlkt_info_billing' loop
      if has_function_privilege(r,f.oid,'EXECUTE') then raise exception 'Browser function grant'; end if;
    end loop;
  end loop;
  if has_any_column_privilege('service_role','dlkt_info_billing.event_notices','INSERT') then raise exception 'Intake bypass'; end if;
  if has_function_privilege('service_role','dlkt_info_billing.claim_notice(text)','EXECUTE') then raise exception 'Intake can claim'; end if;
  if has_function_privilege('dlkt_billing_worker','dlkt_info_billing.ingest_notice(text,text,text,text,bigint)','EXECUTE') then raise exception 'Worker can ingest'; end if;
  if has_table_privilege('dlkt_billing_worker','dlkt_info_billing.event_jobs','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'Worker raw table grant'; end if;
  if has_table_privilege('service_role','dlkt_info_billing.event_jobs','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'Intake raw job grant'; end if;
end;
$$;
set role service_role;
do $$
begin
  if dlkt_info_billing.ingest_notice('acct_A','evt_A','invoice.paid','in_A',100) <> 'duplicate' then raise exception 'Backfill duplicate rejected'; end if;
  begin
    perform dlkt_info_billing.ingest_notice('acct_A','evt_A','invoice.paid','in_Altered',100);
    raise exception 'Conflicting duplicate accepted';
  exception when check_violation then null;
  end;
  if dlkt_info_billing.ingest_notice('acct_B','evt_Q','invoice.payment_failed','in_Q',200) <> 'accepted' then raise exception 'Valid notice not queued'; end if;
  if dlkt_info_billing.ingest_notice('acct_B','evt_Q','invoice.payment_failed','in_Q',200) <> 'duplicate' then raise exception 'Duplicate not recognized'; end if;
  begin
    perform dlkt_info_billing.ingest_notice('acct_B','evt_Live','checkout.session.completed','cs_live_1',200);
    raise exception 'Live notice accepted';
  exception when check_violation then null;
  end;
  begin
    perform dlkt_info_billing.claim_notice('acct_B');
    raise exception 'Intake can claim';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
do $$
begin
  if (select count(*) from dlkt_info_billing.event_jobs where account_id='acct_B') <> 1 then raise exception 'Duplicate created extra job'; end if;
  if exists(select 1 from dlkt_info_billing.event_notices where event_id='evt_Live') then raise exception 'Invalid notice persisted'; end if;
end;
$$;
set role dlkt_billing_worker;
do $$
declare v record;
begin
  select * into strict v from dlkt_info_billing.claim_notice('acct_B');
  if v.account_id <> 'acct_B' or v.event_id <> 'evt_Q' or v.attempt <> 1 then raise exception 'Wrong first lease'; end if;
  if exists(select 1 from dlkt_info_billing.claim_notice('acct_B')) then raise exception 'Active lease claimed twice'; end if;
  if dlkt_info_billing.finish_notice('acct_A','evt_Q',1,'routed') then raise exception 'Wrong account finish accepted'; end if;
  if dlkt_info_billing.finish_notice('acct_B','evt_Q',2,'routed') then raise exception 'Wrong fence accepted'; end if;
  begin
    update dlkt_info_billing.event_jobs set state='routed';
    raise exception 'Worker raw update accepted';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
update dlkt_info_billing.event_jobs set lease_until=clock_timestamp()-interval '1 second' where account_id='acct_B' and event_id='evt_Q';
set role dlkt_billing_worker;
do $$
declare v record;
begin
  if dlkt_info_billing.finish_notice('acct_B','evt_Q',1,'routed') then raise exception 'Expired lease accepted'; end if;
  select * into strict v from dlkt_info_billing.claim_notice('acct_B');
  if v.attempt <> 2 then raise exception 'Fence did not advance'; end if;
  if dlkt_info_billing.finish_notice('acct_B','evt_Q',1,'routed') then raise exception 'Superseded worker accepted'; end if;
  if not dlkt_info_billing.finish_notice('acct_B','evt_Q',2,'retry') then raise exception 'Retry not accepted'; end if;
  if exists(select 1 from dlkt_info_billing.claim_notice('acct_B')) then raise exception 'Retry backoff bypassed'; end if;
end;
$$;
reset role;
update dlkt_info_billing.event_jobs set available_at=clock_timestamp()-interval '1 second' where account_id='acct_B' and event_id='evt_Q';
set role dlkt_billing_worker;
do $$
declare v record;
begin
  select * into strict v from dlkt_info_billing.claim_notice('acct_B');
  if v.attempt <> 3 then raise exception 'Retry fence wrong'; end if;
  if not dlkt_info_billing.finish_notice('acct_B','evt_Q',3,'routed') then raise exception 'Current worker finish rejected'; end if;
  if dlkt_info_billing.finish_notice('acct_B','evt_Q',3,'routed') then raise exception 'Terminal event completed twice'; end if;
  if exists(select 1 from dlkt_info_billing.claim_notice('acct_B')) then raise exception 'Terminal job reclaimed'; end if;
end;
$$;
reset role;
set role service_role;
select dlkt_info_billing.ingest_notice('acct_B','evt_Max','invoice.paid','in_Max',300);
reset role;
-- Advance test fixture only; avoids sleeping for multiple lease intervals.
update dlkt_info_billing.event_jobs set state='leased',attempt=5,lease_until=clock_timestamp()-interval '1 second' where account_id='acct_B' and event_id='evt_Max';
set role dlkt_billing_worker;
do $$
begin
  if exists(select 1 from dlkt_info_billing.claim_notice('acct_B')) then raise exception 'Exhausted job reclaimed'; end if;
end;
$$;
reset role;
do $$
begin
  if not exists(select 1 from dlkt_info_billing.event_jobs where account_id='acct_B' and event_id='evt_Max' and state='dead' and outcome='attempts_exhausted') then raise exception 'Exhausted lease not dead-lettered'; end if;
  if not exists(select 1 from dlkt_info_billing.event_jobs where account_id='acct_B' and event_id='evt_Q' and state='routed' and attempt=3) then raise exception 'Terminal receipt missing'; end if;
end;
$$;
-- A third synthetic account isolates the parallel connection checks.
insert into dlkt_info_billing.catalog_accounts(account_id,product_id) values ('acct_Concurrent','prod_Concurrent');
select 'BILLING_QUEUE_ISOLATED_SQL_OK' as result;
