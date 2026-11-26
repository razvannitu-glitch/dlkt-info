-- Integration-only additive runtime capability wrappers. No LOGIN or credential provisioning.
do $$
begin
 if current_user<>'postgres'
 or (select count(*) from dlkt_info_runtime.instance)<>1
 or not exists(select 1 from dlkt_info_runtime.instance where singleton and project_ref='hziavqdhsqnihxuuxzhn' and environment='integration' and contract_version=1)
 or (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname like 'dlkt_info_%' and c.relkind='r')<>19
 or (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname like 'dlkt_info_%')<>43
 or (select count(*) from pg_roles where rolname like 'dlkt_rt_%')<>11
 or exists(select 1 from pg_roles where rolname like 'dlkt_rt_%' and rolcanlogin)
 or exists(select 1 from pg_stat_activity where usename like 'dlkt_rt_%')
 or exists(select 1 from auth.users) or exists(select 1 from auth.sessions)
 or exists(select 1 from dlkt_info_billing.event_notices) or exists(select 1 from dlkt_info_billing.customer_bindings)
 or exists(select 1 from pg_roles where rolname=any(array['dlkt_rt_invoice','dlkt_rt_risk','dlkt_rt_checkout_route']))
 or (select count(*) from pg_roles where rolname=any(array['dlkt_billing_invoice_router','dlkt_billing_risk_router','dlkt_billing_checkout_router']) and not rolcanlogin and not rolbypassrls and not rolsuper and not rolcreaterole and not rolcreatedb and not rolreplication)<>3
 then raise exception 'RUNTIME_ROUTER_PRECONDITION';end if;
end;
$$;
create role dlkt_rt_invoice nologin inherit nobypassrls nocreaterole nocreatedb noreplication password null;
grant dlkt_billing_invoice_router to dlkt_rt_invoice with inherit true, set false;
grant dlkt_rt_invoice to postgres with inherit false, set true;
create role dlkt_rt_risk nologin inherit nobypassrls nocreaterole nocreatedb noreplication password null;
grant dlkt_billing_risk_router to dlkt_rt_risk with inherit true, set false;
grant dlkt_rt_risk to postgres with inherit false, set true;
create role dlkt_rt_checkout_route nologin inherit nobypassrls nocreaterole nocreatedb noreplication password null;
grant dlkt_billing_checkout_router to dlkt_rt_checkout_route with inherit true, set false;
grant dlkt_rt_checkout_route to postgres with inherit false, set true;
grant usage on schema dlkt_info_runtime to dlkt_rt_invoice,dlkt_rt_risk,dlkt_rt_checkout_route;
grant select on dlkt_info_runtime.instance to dlkt_rt_invoice,dlkt_rt_risk,dlkt_rt_checkout_route;
create policy runtime_router_identity_read on dlkt_info_runtime.instance for select to dlkt_rt_invoice,dlkt_rt_risk,dlkt_rt_checkout_route using(true);
grant execute on function dlkt_info_runtime.identity() to dlkt_rt_invoice,dlkt_rt_risk,dlkt_rt_checkout_route;
do $$
declare r text; f record; t record; expected text[]; expected_role text; acl text;
begin
 if (select count(*) from pg_roles where rolname like 'dlkt_rt_%')<>14
 or exists(select 1 from pg_roles where rolname like 'dlkt_rt_%' and (rolcanlogin or rolsuper or rolbypassrls or rolcreaterole or rolcreatedb or rolreplication))
 or exists(select 1 from pg_stat_activity where usename like 'dlkt_rt_%')
 then raise exception 'Runtime role state invalid';end if;
 foreach r in array array['dlkt_rt_invoice','dlkt_rt_risk','dlkt_rt_checkout_route'] loop
  expected_role:=case r
   when 'dlkt_rt_invoice' then 'dlkt_billing_invoice_router'
   when 'dlkt_rt_risk' then 'dlkt_billing_risk_router'
   when 'dlkt_rt_checkout_route' then 'dlkt_billing_checkout_router'
  end;
  expected:=case r
   when 'dlkt_rt_invoice' then array['read_invoice_binding','route_invoice_notice']
   when 'dlkt_rt_risk' then array['read_invoice_binding','route_risk_notice']
   when 'dlkt_rt_checkout_route' then array['read_checkout_notice_binding','route_checkout_notice']
  end;
  if (select count(*) from pg_auth_members m join pg_roles u on u.oid=m.member where u.rolname=r)<>1
  or not exists(select 1 from pg_auth_members m join pg_roles u on u.oid=m.member join pg_roles g on g.oid=m.roleid where u.rolname=r and g.rolname=expected_role and m.inherit_option and not m.set_option and not m.admin_option)
  or pg_has_role(r,'postgres','MEMBER') or pg_has_role(r,'service_role','MEMBER') or pg_has_role(r,'authenticated','MEMBER')
  or not has_schema_privilege(r,'dlkt_info_runtime','USAGE') or not has_table_privilege(r,'dlkt_info_runtime.instance','SELECT') or has_table_privilege(r,'dlkt_info_runtime.instance','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  or not has_function_privilege(r,'dlkt_info_runtime.identity()','EXECUTE') then raise exception 'Runtime capability boundary invalid: %',r;end if;
  for f in select p.oid,p.proname,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname like 'dlkt_info_%' and n.nspname<>'dlkt_info_runtime' loop
   if has_function_privilege(r,f.oid,'EXECUTE') is distinct from (f.nspname='dlkt_info_billing' and f.proname=any(expected)) then raise exception 'Unexpected runtime function ACL: % / %',r,f.proname;end if;
  end loop;
  for t in select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname like 'dlkt_info_%' and n.nspname<>'dlkt_info_runtime' and c.relkind='r' loop
   if has_table_privilege(r,t.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or has_any_column_privilege(r,t.oid,'SELECT,INSERT,UPDATE,REFERENCES') then raise exception 'Runtime direct data ACL: %',r;end if;
  end loop;
  if has_any_column_privilege(r,'auth.users','SELECT,INSERT,UPDATE,REFERENCES') or has_any_column_privilege(r,'auth.sessions','SELECT,INSERT,UPDATE,REFERENCES') then raise exception 'Runtime Auth ACL';end if;
 end loop;
 foreach r in array array['anon','authenticated','authenticator','service_role'] loop
  if exists(select 1 from pg_roles where rolname=any(array['dlkt_rt_invoice','dlkt_rt_risk','dlkt_rt_checkout_route']) and pg_has_role(r,oid,'MEMBER')) then raise exception 'Broad router membership';end if;
 end loop;
end;
$$;
