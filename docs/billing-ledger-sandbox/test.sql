-- Run after setup.sql and ledger.sql. All checks fail hard; no production database.
insert into dlkt_info_billing.catalog_accounts(account_id,product_id) values ('acct_A','prod_A'),('acct_B','prod_B');
insert into dlkt_info_billing.catalog_prices(account_id,price_id,plan,amount_cents)
values ('acct_A','price_A','monthly',699),('acct_A','price_Annual','annual',6900),('acct_B','price_B','monthly',699);
do $$
declare r text; t record;
begin
  if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='dlkt_info_billing' and c.relkind='r' and c.relrowsecurity) <> 6 then
    raise exception 'RLS not enabled for all six ledger tables';
  end if;
  foreach r in array array['anon','authenticated'] loop
    if has_schema_privilege(r,'dlkt_info_billing','USAGE') or has_schema_privilege(r,'dlkt_info_billing','CREATE') then
      raise exception 'Browser role has private schema access: %',r;
    end if;
    for t in select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='dlkt_info_billing' and c.relkind='r' loop
      if has_table_privilege(r,t.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or has_any_column_privilege(r,t.oid,'SELECT,INSERT,UPDATE,REFERENCES') then
        raise exception 'Browser role has table or column grant';
      end if;
    end loop;
  end loop;
  begin
    insert into dlkt_info_billing.catalog_accounts(account_id,product_id,live_mode) values ('acct_Live','prod_Live',true);
    raise exception 'Live account accepted';
  exception when check_violation then null;
  end;
  begin
    insert into dlkt_info_billing.catalog_prices(account_id,price_id,plan,amount_cents) values ('acct_B','price_Wrong','annual',1);
    raise exception 'Unapproved amount accepted';
  exception when check_violation then null;
  end;
end;
$$;

set role service_role;
insert into dlkt_info_billing.customer_bindings(account_id,customer_id,owner_id) values
('acct_A','cus_A','00000000-0000-4000-8000-000000000001'),
('acct_A','cus_B','00000000-0000-4000-8000-000000000002');

do $$
begin
  begin
    insert into dlkt_info_billing.customer_bindings(account_id,customer_id,owner_id) values ('acct_A','cus_Duplicate','00000000-0000-4000-8000-000000000001');
    raise exception 'Multiple customer bindings accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into dlkt_info_billing.customer_bindings(account_id,customer_id,owner_id) values ('acct_A','cus_A','00000000-0000-4000-8000-000000000002');
    raise exception 'Customer rebind accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into dlkt_info_billing.customer_bindings(account_id,customer_id,owner_id) values ('acct_A','cus_Unbound',null);
    raise exception 'Unbound customer inserted';
  exception when not_null_violation then null;
  end;
  begin
    update dlkt_info_billing.customer_bindings set owner_id='00000000-0000-4000-8000-000000000002' where customer_id='cus_A';
    raise exception 'Customer binding mutation accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into dlkt_info_billing.catalog_accounts(account_id,product_id) values ('acct_Unexpected','prod_Unexpected');
    raise exception 'Runtime catalog modification accepted';
  exception when insufficient_privilege then null;
  end;
end;
$$;
insert into dlkt_info_billing.checkout_intents(intent_id,account_id,customer_id,price_id) values
('10000000-0000-4000-8000-000000000001','acct_A','cus_A','price_A'),
('10000000-0000-4000-8000-000000000002','acct_A','cus_B','price_Annual');

do $$
begin
  begin
    insert into dlkt_info_billing.checkout_intents(intent_id,account_id,customer_id,price_id) values ('10000000-0000-4000-8000-000000000003','acct_A','cus_A','price_Annual');
    raise exception 'Duplicate open checkout accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into dlkt_info_billing.checkout_intents(intent_id,account_id,customer_id,price_id) values ('10000000-0000-4000-8000-000000000004','acct_B','cus_A','price_B');
    raise exception 'Foreign account customer accepted';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into dlkt_info_billing.checkout_intents(intent_id,account_id,customer_id,price_id) values ('10000000-0000-4000-8000-000000000005','acct_A','cus_A','price_B');
    raise exception 'Foreign account price accepted';
  exception when foreign_key_violation then null;
  end;
  begin
    update dlkt_info_billing.checkout_intents set closed_at=clock_timestamp() where customer_id='cus_A';
    raise exception 'Unverified checkout close accepted';
  exception when insufficient_privilege then null;
  end;
end;
$$;
insert into dlkt_info_billing.subscription_bindings(account_id,customer_id,subscription_id,price_id,item_id)
values ('acct_A','cus_A','sub_A','price_A','si_A');
do $$
begin
  begin
    insert into dlkt_info_billing.subscription_bindings(account_id,customer_id,subscription_id,price_id,item_id)
    values ('acct_A','cus_B','sub_A','price_A','si_B');
    raise exception 'Subscription rebind accepted';
  exception when unique_violation then null;
  end;
end;
$$;
insert into dlkt_info_billing.event_notices(account_id,event_id,event_type,object_id,event_created)
values ('acct_A','evt_A','invoice.paid','in_A',100);
insert into dlkt_info_billing.event_notices(account_id,event_id,event_type,object_id,event_created)
values ('acct_A','evt_A','invoice.paid','in_A',100) on conflict (account_id,event_id) do nothing;
do $$
begin
  if (select count(*) from dlkt_info_billing.event_notices) <> 1 then
    raise exception 'Webhook identity deduplication failed';
  end if;
  begin
    insert into dlkt_info_billing.event_notices(account_id,event_id,event_type,object_id,event_created)
    values ('acct_A','evt_B','checkout.session.completed','cs_live_A',100);
    raise exception 'Live session notice accepted';
  exception when check_violation then null;
  end;
  begin
    delete from dlkt_info_billing.event_notices where event_id='evt_A';
    raise exception 'Runtime ledger deletion accepted';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

set role authenticated;
do $$
begin
  begin
    perform 1 from dlkt_info_billing.customer_bindings;
    raise exception 'Browser read accepted';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
delete from auth.users where id='00000000-0000-4000-8000-000000000001';
do $$
begin
  if not exists(select 1 from dlkt_info_billing.customer_bindings where customer_id='cus_A' and owner_id is null) then
    raise exception 'Deletion tombstone not preserved';
  end if;
  if not exists(select 1 from dlkt_info_billing.subscription_bindings where subscription_id='sub_A') then
    raise exception 'Stripe binding prematurely erased';
  end if;
end;
$$;
select 'BILLING_LEDGER_ISOLATED_SQL_OK' as result;
