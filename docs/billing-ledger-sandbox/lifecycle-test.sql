-- Synthetic identities only. No provider writes or real deletion.
insert into auth.users(id) values
 ('00000000-0000-4000-8000-000000000010'),('00000000-0000-4000-8000-000000000011'),('00000000-0000-4000-8000-000000000012');
insert into auth.sessions(id,user_id,not_after) values
 ('10000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000010',null),
 ('20000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000010',null),
 ('10000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000011',null),
 ('10000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000012',null);
set role service_role;
insert into dlkt_info_billing.customer_bindings(account_id,customer_id,owner_id) values
 ('acct_Checkout','cus_Closure','00000000-0000-4000-8000-000000000010');
reset role;
set role dlkt_billing_checkout_api;
select * from dlkt_info_billing.reserve_checkout('acct_Checkout','00000000-0000-4000-8000-000000000010','monthly','20000000-0000-4000-8000-000000000010');
reset role;
set role dlkt_connection_vault_api;
select dlkt_info_connection_vault.save_connection('00000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000010','gmail',
 '40000000-0000-4000-8000-000000000010','Fixture','connected','v1.'||repeat('A',16)||'.'||repeat('B',22)||'.'||repeat('C',24),
 clock_timestamp()-interval '1 minute',null,null,'50000000-0000-4000-8000-000000000010',null);
select dlkt_info_connection_vault.put_authorization('00000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000010',
 'gmail',repeat('J',43),repeat('K',43),'v1.'||repeat('A',16)||'.'||repeat('B',22)||'.'||repeat('C',24),clock_timestamp()+interval '300 seconds');
reset role;
do $$
declare r text; f record;t record;
begin
 if exists(select 1 from pg_roles where rolname='dlkt_account_lifecycle_owner' and (rolsuper or rolcanlogin or rolbypassrls)) then raise exception 'Unrestricted lifecycle owner'; end if;
 if has_schema_privilege('dlkt_account_lifecycle_owner','dlkt_info_account_lifecycle','CREATE') then raise exception 'Owner CREATE retained'; end if;
 foreach r in array array['anon','authenticated','service_role','dlkt_account_lifecycle_api','dlkt_account_lifecycle_review'] loop
   for t in select c.oid,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='dlkt_info_account_lifecycle' and c.relkind='r' loop
     if not t.relrowsecurity or has_table_privilege(r,t.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or has_any_column_privilege(r,t.oid,'SELECT,INSERT,UPDATE,REFERENCES') then raise exception 'Direct lifecycle table access'; end if;
   end loop;
   if r in ('anon','authenticated','service_role') then
     if has_schema_privilege(r,'dlkt_info_account_lifecycle','USAGE') then raise exception 'Broad schema access'; end if;
     for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='dlkt_info_account_lifecycle' loop
       if has_function_privilege(r,f.oid,'EXECUTE') then raise exception 'Broad function access'; end if;
     end loop;
   end if;
 end loop;
 if has_function_privilege('dlkt_account_lifecycle_api','dlkt_info_account_lifecycle.note_blocker(uuid,text,bigint,text,text)','EXECUTE') then raise exception 'User API can write operator outcome'; end if;
 if has_function_privilege('dlkt_account_lifecycle_review','dlkt_info_account_lifecycle.request_closure(uuid,uuid,uuid)','EXECUTE') then raise exception 'Review role can initiate closure'; end if;
 begin
   delete from auth.users where id='00000000-0000-4000-8000-000000000010';
   raise exception 'Direct deletion of account with financial or provider records accepted';
 exception when object_not_in_prerequisite_state then null;
 end;
end;
$$;
set role dlkt_account_lifecycle_api;
do $$
declare o uuid:='00000000-0000-4000-8000-000000000010';s uuid:='10000000-0000-4000-8000-000000000010';
 req uuid:='30000000-0000-4000-8000-000000000010'; x record;
begin
 begin
   perform dlkt_info_account_lifecycle.request_closure(o,'10000000-0000-4000-8000-000000000011',req);
   raise exception 'Foreign session requested closure';
 exception when invalid_authorization_specification then null;end;
 select * into strict x from dlkt_info_account_lifecycle.request_closure(o,s,req);
 if x.request_id<>req or x.state<>'pending_cleanup' then raise exception 'Closure request missing';end if;
 select * into strict x from dlkt_info_account_lifecycle.request_closure(o,s,'60000000-0000-4000-8000-000000000010');
 if x.request_id<>req then raise exception 'Closure request duplicated';end if;
 if exists(select 1 from dlkt_info_account_lifecycle.read_closure('00000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000011')) then raise exception 'Other owner closure exposed';end if;
end;
$$;
reset role;
set role dlkt_account_lifecycle_review;
do $$
declare x record; req uuid:='30000000-0000-4000-8000-000000000010';
begin
 select * into strict x from dlkt_info_account_lifecycle.inspect_closure(req);
 if x.sessions<>2 or x.connections<>1 or x.pending_oauth<>1 or x.open_checkout<>1 or x.subscriptions<>0 or x.billing_customers<>1 then raise exception 'Incomplete obligation inventory';end if;
 if (select count(*) from dlkt_info_account_lifecycle.read_tasks(req))<>6 then raise exception 'Closure tasks not atomic';end if;
 if dlkt_info_account_lifecycle.note_blocker(req,'resolve_subscriptions',0,'complete','payment_state_unknown') then raise exception 'False completion accepted';end if;
 if not dlkt_info_account_lifecycle.note_blocker(req,'resolve_subscriptions',0,'manual_review','payment_state_unknown') then raise exception 'Manual review not persisted';end if;
 if dlkt_info_account_lifecycle.note_blocker(req,'resolve_subscriptions',0,'retry','provider_unavailable') then raise exception 'Stale review overwrote newer status';end if;
end;
$$;
reset role;
set role dlkt_connection_vault_api;
do $$
declare o uuid:='00000000-0000-4000-8000-000000000010';s uuid:='10000000-0000-4000-8000-000000000010';
begin
 begin perform dlkt_info_connection_vault.list_connections(o,s);raise exception 'Frozen account read grant';exception when object_not_in_prerequisite_state then null;end;
 begin perform dlkt_info_connection_vault.remove_connection(o,s,'gmail','50000000-0000-4000-8000-000000000010');raise exception 'Unverified grant erased';exception when object_not_in_prerequisite_state then null;end;
 begin perform dlkt_info_connection_vault.consume_authorization(o,s,'gmail',repeat('J',43),repeat('K',43));raise exception 'Frozen account consumed OAuth';exception when object_not_in_prerequisite_state then null;end;
end;
$$;
reset role;
set role dlkt_billing_checkout_api;
do $$
declare o uuid:='00000000-0000-4000-8000-000000000010';i uuid:='20000000-0000-4000-8000-000000000010';
begin
 begin perform dlkt_info_billing.reserve_checkout('acct_Checkout',o,'monthly',i);raise exception 'Frozen account reused checkout';exception when object_not_in_prerequisite_state then null;end;
 begin perform dlkt_info_billing.attach_checkout('acct_Checkout',i,o,'cus_Closure','price_CheckoutMonth','cs_test_Late',0);raise exception 'Frozen account attached checkout';exception when object_not_in_prerequisite_state then null;end;
end;
$$;
reset role;
set role service_role;
do $$
begin
 begin
   insert into dlkt_info_billing.customer_bindings(account_id,customer_id,owner_id) values('acct_A','cus_ClosureNew','00000000-0000-4000-8000-000000000010');
   raise exception 'New customer after closure';
 exception when object_not_in_prerequisite_state then null;end;
end;
$$;
reset role;
-- Late terminal payment must be recorded rather than discarded. It cannot
-- reopen access or clear the operator's financial review obligation.
set role dlkt_billing_checkout_recovery;
do $$
declare x record;
begin
 select * into strict x from dlkt_info_billing.read_checkout('acct_Checkout','20000000-0000-4000-8000-000000000010');
 if not dlkt_info_billing.finish_checkout(x.account_id,x.intent_id,x.owner_id,x.customer_id,x.price_id,'cs_test_Late',x.expires_at,'complete','paid','sub_ClosureLate','si_ClosureLate') then raise exception 'Late payment not recorded';end if;
end;
$$;
reset role;
set role dlkt_account_lifecycle_review;
do $$
declare x record;
begin
 select * into strict x from dlkt_info_account_lifecycle.inspect_closure('30000000-0000-4000-8000-000000000010');
 if x.open_checkout<>0 or x.subscriptions<>1 or x.state<>'pending_cleanup' then raise exception 'Late obligation not visible';end if;
end;
$$;
reset role;
-- Model provider-confirmed session removal using the disposable admin. This is
-- NOT a production implementation of global logout or token revocation.
delete from auth.sessions where user_id='00000000-0000-4000-8000-000000000010';
set role dlkt_account_lifecycle_api;
do $$
begin
 begin perform dlkt_info_account_lifecycle.read_closure('00000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000010');raise exception 'Revoked session read closure';exception when invalid_authorization_specification then null;end;
end;
$$;
reset role;
set role dlkt_account_lifecycle_review;
do $$
declare x record;
begin
 select * into strict x from dlkt_info_account_lifecycle.inspect_closure('30000000-0000-4000-8000-000000000010');
 if x.sessions<>0 or x.connections<>1 or x.pending_oauth<>0 or x.subscriptions<>1 or x.state<>'pending_cleanup' then raise exception 'Revocation discarded obligations';end if;
end;
$$;
reset role;
do $$
begin
 begin delete from auth.users where id='00000000-0000-4000-8000-000000000010';raise exception 'Closing account deleted';exception when object_not_in_prerequisite_state then null;end;
 if not exists(select 1 from dlkt_info_connection_vault.connections where owner_id='00000000-0000-4000-8000-000000000010') then raise exception 'Credential destroyed before cleanup';end if;
 if not exists(select 1 from dlkt_info_billing.customer_bindings where customer_id='cus_Closure' and owner_id='00000000-0000-4000-8000-000000000010') then raise exception 'Financial ownership lost';end if;
end;
$$;
select 'SECURE_ACCOUNT_LIFECYCLE_SQL_OK' as result;
