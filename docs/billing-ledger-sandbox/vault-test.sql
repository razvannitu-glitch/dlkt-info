-- Synthetic users and encrypted-looking fixture strings; no actual provider credentials.
insert into auth.users(id) values ('00000000-0000-4000-8000-000000000008'),('00000000-0000-4000-8000-000000000009');
insert into auth.sessions(id,user_id,not_after) values
('10000000-0000-4000-8000-000000000008','00000000-0000-4000-8000-000000000008',null),
('20000000-0000-4000-8000-000000000008','00000000-0000-4000-8000-000000000008',null),
('10000000-0000-4000-8000-000000000009','00000000-0000-4000-8000-000000000009',null),
('30000000-0000-4000-8000-000000000008','00000000-0000-4000-8000-000000000008',clock_timestamp()-interval '1 second');
do $$
declare r text; t record; f record;
begin
  if exists(select 1 from pg_roles where rolname='dlkt_connection_vault_owner' and (rolcanlogin or rolbypassrls or rolsuper)) then raise exception 'Unrestricted vault owner'; end if;
  if has_schema_privilege('dlkt_connection_vault_owner','dlkt_info_connection_vault','CREATE') then raise exception 'Definer retained CREATE'; end if;
  foreach r in array array['anon','authenticated','service_role'] loop
    if has_schema_privilege(r,'dlkt_info_connection_vault','USAGE') then raise exception 'Broad role vault schema access'; end if;
    for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='dlkt_info_connection_vault' loop
      if has_function_privilege(r,f.oid,'EXECUTE') then raise exception 'Broad role vault function access'; end if;
    end loop;
  end loop;
  foreach r in array array['anon','authenticated','service_role','dlkt_connection_vault_api'] loop
    for t in select c.oid,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='dlkt_info_connection_vault' and c.relkind='r' loop
      if not t.relrowsecurity or has_table_privilege(r,t.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or has_any_column_privilege(r,t.oid,'SELECT,INSERT,UPDATE,REFERENCES') then raise exception 'Vault table ACL/RLS failure'; end if;
    end loop;
  end loop;
  if has_any_column_privilege('dlkt_connection_vault_api','auth.sessions','SELECT,INSERT,UPDATE,REFERENCES') then raise exception 'Runtime raw auth grant'; end if;
  if has_table_privilege('dlkt_connection_vault_owner','auth.sessions','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'Definer broad auth grant'; end if;
end;
$$;
set role dlkt_connection_vault_api;
do $$
declare o uuid:='00000000-0000-4000-8000-000000000008'; other uuid:='00000000-0000-4000-8000-000000000009';
s uuid:='10000000-0000-4000-8000-000000000008'; s2 uuid:='20000000-0000-4000-8000-000000000008';
os uuid:='10000000-0000-4000-8000-000000000009'; c uuid:='40000000-0000-4000-8000-000000000008';
r1 uuid:='50000000-0000-4000-8000-000000000008'; r2 uuid:='60000000-0000-4000-8000-000000000008';
n timestamptz:=date_trunc('second',clock_timestamp())-interval '1 minute';
sealed text:='v1.'||repeat('A',16)||'.'||repeat('B',22)||'.'||repeat('C',24);
x record;
begin
  begin perform dlkt_info_connection_vault.list_connections(o,os); raise exception 'Foreign session accepted'; exception when invalid_authorization_specification then null; end;
  begin perform dlkt_info_connection_vault.list_connections(o,'30000000-0000-4000-8000-000000000008'); raise exception 'Expired session accepted'; exception when invalid_authorization_specification then null; end;
  if not dlkt_info_connection_vault.save_connection(o,s,'gmail',c,'Fixture','connected',sealed,n,null,null,r1,null) then raise exception 'Valid initial CAS failed'; end if;
  if dlkt_info_connection_vault.save_connection(o,s,'gmail',c,'Fixture','connected',sealed,n,null,null,r2,null) then raise exception 'Duplicate initial insert'; end if;
  if exists(select 1 from dlkt_info_connection_vault.list_connections(other,os)) then raise exception 'Cross-owner read'; end if;
  select * into strict x from dlkt_info_connection_vault.read_connection(o,s2,'gmail');
  if x.connection_id<>c or x.revision<>r1 then raise exception 'Wrong saved row'; end if;
  if dlkt_info_connection_vault.save_connection(o,s,'gmail',c,'Fixture','connected',sealed,n,null,null,r2,r2) then raise exception 'Unchanged revision accepted'; end if;
  if dlkt_info_connection_vault.save_connection(o,s,'gmail','40000000-0000-4000-8000-000000000009','Fixture','connected',sealed,n,null,null,r2,r1) then raise exception 'Connection identity replaced'; end if;
  if not dlkt_info_connection_vault.save_connection(o,s,'gmail',c,'Fixture','connected',sealed,n,null,clock_timestamp()+interval '120 seconds',r2,r1) then raise exception 'Valid CAS lease failed'; end if;
  if dlkt_info_connection_vault.remove_connection(o,s,'gmail',r1) then raise exception 'Stale delete accepted'; end if;
  if dlkt_info_connection_vault.remove_connection(other,os,'gmail',r2) then raise exception 'Foreign delete accepted'; end if;
  begin
    perform dlkt_info_connection_vault.save_connection(o,s,'outlook','40000000-0000-4000-8000-000000000009','Fixture','connected','plaintext',n,null,null,r1,null);
    raise exception 'Plaintext token accepted';
  exception when check_violation then null;
  end;
  if not dlkt_info_connection_vault.put_authorization(o,s,'gmail',repeat('D',43),repeat('E',43),sealed,clock_timestamp()+interval '300 seconds') then raise exception 'Valid pending failed'; end if;
  if exists(select 1 from dlkt_info_connection_vault.consume_authorization(o,s2,'gmail',repeat('D',43),repeat('E',43))) then raise exception 'Other session consumed OAuth'; end if;
  if exists(select 1 from dlkt_info_connection_vault.consume_authorization(o,s,'outlook',repeat('D',43),repeat('E',43))) then raise exception 'Other provider consumed OAuth'; end if;
  if exists(select 1 from dlkt_info_connection_vault.consume_authorization(o,s,'gmail',repeat('D',43),repeat('F',43))) then raise exception 'Wrong session hash consumed OAuth'; end if;
  select * into strict x from dlkt_info_connection_vault.consume_authorization(o,s,'gmail',repeat('D',43),repeat('E',43));
  if x.session_id<>s or x.provider_id<>'gmail' then raise exception 'Wrong consumed row'; end if;
  if exists(select 1 from dlkt_info_connection_vault.consume_authorization(o,s,'gmail',repeat('D',43),repeat('E',43))) then raise exception 'OAuth replay'; end if;
  if dlkt_info_connection_vault.put_authorization(o,s,'gmail',repeat('G',43),repeat('E',43),sealed,clock_timestamp()+interval '601 seconds') then raise exception 'Excessive OAuth expiry'; end if;
  if not dlkt_info_connection_vault.put_authorization(o,s,'gmail',repeat('G',43),repeat('E',43),sealed,clock_timestamp()+interval '300 seconds') then raise exception 'Second pending failed'; end if;
end;
$$;
reset role;
delete from auth.sessions where id='10000000-0000-4000-8000-000000000008';
do $$
begin
  if exists(select 1 from dlkt_info_connection_vault.pending_authorizations where state_hash=repeat('G',43)) then raise exception 'Revoked OAuth pending survived'; end if;
end;
$$;
set role dlkt_connection_vault_api;
do $$
declare o uuid:='00000000-0000-4000-8000-000000000008'; s uuid:='10000000-0000-4000-8000-000000000008'; s2 uuid:='20000000-0000-4000-8000-000000000008';
begin
  begin perform dlkt_info_connection_vault.read_connection(o,s,'gmail'); raise exception 'Revoked session read'; exception when invalid_authorization_specification then null; end;
  begin perform dlkt_info_connection_vault.remove_connection(o,s,'gmail','60000000-0000-4000-8000-000000000008'); raise exception 'Revoked session delete'; exception when invalid_authorization_specification then null; end;
  if not dlkt_info_connection_vault.remove_connection(o,s2,'gmail','60000000-0000-4000-8000-000000000008') then raise exception 'Authenticated disconnect failed'; end if;
  if not dlkt_info_connection_vault.put_authorization(o,s2,'gmail',repeat('H',43),repeat('I',43),'v1.'||repeat('A',16)||'.'||repeat('B',22)||'.'||repeat('C',24),clock_timestamp()+interval '300 seconds') then raise exception 'Race fixture failed'; end if;
end;
$$;
reset role;
select 'PRIVATE_CONNECTION_VAULT_SQL_OK' as result;
