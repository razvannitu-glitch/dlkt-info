-- Integration-only read-only connection identity probe. No password/token and no LOGIN.
do $$
begin
 if exists(select 1 from pg_roles where rolname='dlkt_rt_probe')
 or not exists(select 1 from dlkt_info_runtime.instance where project_ref='hziavqdhsqnihxuuxzhn' and environment='integration' and contract_version=1)
 or exists(select 1 from pg_roles where rolname like 'dlkt_rt_%' and rolcanlogin)
 then raise exception 'PROBE_PROVISIONING_PRECONDITION';end if;
end;
$$;
create role dlkt_rt_probe nologin noinherit nobypassrls nocreaterole nocreatedb noreplication password null;
grant dlkt_rt_probe to postgres with set true, inherit false;
grant usage on schema dlkt_info_runtime to dlkt_rt_probe;
grant select on dlkt_info_runtime.instance to dlkt_rt_probe;
grant execute on function dlkt_info_runtime.identity() to dlkt_rt_probe;
create policy runtime_probe_identity_read on dlkt_info_runtime.instance for select to dlkt_rt_probe using(true);
do $$
declare s text; f record; t record;
begin
 if exists(select 1 from pg_roles where rolname='dlkt_rt_probe' and (rolcanlogin or rolsuper or rolbypassrls or rolcreaterole or rolcreatedb or rolreplication)) then raise exception 'Probe role overprivileged';end if;
 if exists(select 1 from pg_auth_members where member=(select oid from pg_roles where rolname='dlkt_rt_probe')) then raise exception 'Probe role membership';end if;
 foreach s in array array['dlkt_info_billing','dlkt_info_connection_vault','dlkt_info_account_lifecycle','dlkt_info_auth_boundary'] loop
  if has_schema_privilege('dlkt_rt_probe',s,'USAGE') then raise exception 'Probe can access private schema %',s;end if;
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=s loop
    if has_function_privilege('dlkt_rt_probe',f.oid,'EXECUTE') then raise exception 'Probe can execute private function';end if;
  end loop;
  for t in select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=s and c.relkind='r' loop
    if has_table_privilege('dlkt_rt_probe',t.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or has_any_column_privilege('dlkt_rt_probe',t.oid,'SELECT,INSERT,UPDATE,REFERENCES') then raise exception 'Probe can access private table';end if;
  end loop;
 end loop;
 if has_any_column_privilege('dlkt_rt_probe','auth.sessions','SELECT,INSERT,UPDATE,REFERENCES') or has_any_column_privilege('dlkt_rt_probe','auth.users','SELECT,INSERT,UPDATE,REFERENCES') then raise exception 'Probe can access Auth';end if;
 if has_table_privilege('dlkt_rt_probe','dlkt_info_runtime.instance','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or has_schema_privilege('dlkt_rt_probe','dlkt_info_runtime','CREATE') then raise exception 'Probe can mutate identity';end if;
end;
$$;