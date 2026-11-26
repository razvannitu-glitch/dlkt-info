-- Integration project hziavqdhsqnihxuuxzhn only. Credential activation is separate.
do $$
begin
 if exists(select 1 from pg_namespace where nspname='dlkt_info_runtime')
 or exists(select 1 from pg_roles where rolname like 'dlkt_rt_%')
 or exists(select 1 from auth.users) or exists(select 1 from auth.sessions)
 or (select count(*) from dlkt_info_billing.catalog_prices)<>2
 or not exists(select 1 from dlkt_info_billing.catalog_accounts where account_id='acct_1Ug2Sh77EKtnzo3p' and live_mode=false)
 then raise exception 'RUNTIME_PROVISIONING_PRECONDITION';end if;
end;
$$;
create role dlkt_rt_vault nologin inherit nobypassrls nocreaterole nocreatedb noreplication password null;
grant dlkt_connection_vault_api to dlkt_rt_vault with inherit true, set false;
grant dlkt_rt_vault to postgres with set true, inherit false;
create role dlkt_rt_checkout nologin inherit nobypassrls nocreaterole nocreatedb noreplication password null;
grant dlkt_billing_checkout_api to dlkt_rt_checkout with inherit true, set false;
grant dlkt_rt_checkout to postgres with set true, inherit false;
create role dlkt_rt_recovery nologin inherit nobypassrls nocreaterole nocreatedb noreplication password null;
grant dlkt_billing_checkout_recovery to dlkt_rt_recovery with inherit true, set false;
grant dlkt_rt_recovery to postgres with set true, inherit false;
create role dlkt_rt_ingress nologin inherit nobypassrls nocreaterole nocreatedb noreplication password null;
grant dlkt_billing_ingress to dlkt_rt_ingress with inherit true, set false;
grant dlkt_rt_ingress to postgres with set true, inherit false;
create role dlkt_rt_worker nologin inherit nobypassrls nocreaterole nocreatedb noreplication password null;
grant dlkt_billing_worker to dlkt_rt_worker with inherit true, set false;
grant dlkt_rt_worker to postgres with set true, inherit false;
create role dlkt_rt_reconcile nologin inherit nobypassrls nocreaterole nocreatedb noreplication password null;
grant dlkt_billing_reconciler to dlkt_rt_reconcile with inherit true, set false;
grant dlkt_rt_reconcile to postgres with set true, inherit false;
create role dlkt_rt_customer nologin inherit nobypassrls nocreaterole nocreatedb noreplication password null;
grant dlkt_billing_customer_writer to dlkt_rt_customer with inherit true, set false;
grant dlkt_billing_catalog_reader to dlkt_rt_customer with inherit true, set false;
grant dlkt_rt_customer to postgres with set true, inherit false;
create role dlkt_rt_closure nologin inherit nobypassrls nocreaterole nocreatedb noreplication password null;
grant dlkt_account_lifecycle_api to dlkt_rt_closure with inherit true, set false;
grant dlkt_rt_closure to postgres with set true, inherit false;
create role dlkt_rt_review nologin inherit nobypassrls nocreaterole nocreatedb noreplication password null;
grant dlkt_account_lifecycle_review to dlkt_rt_review with inherit true, set false;
grant dlkt_rt_review to postgres with set true, inherit false;
create role dlkt_rt_cleanup nologin inherit nobypassrls nocreaterole nocreatedb noreplication password null;
grant dlkt_account_cleanup_worker to dlkt_rt_cleanup with inherit true, set false;
grant dlkt_rt_cleanup to postgres with set true, inherit false;
create schema dlkt_info_runtime;
revoke all on schema dlkt_info_runtime from public,anon,authenticated,authenticator,service_role;
create table dlkt_info_runtime.instance(
 singleton boolean primary key default true check(singleton),
 project_ref text not null check(project_ref='hziavqdhsqnihxuuxzhn'),
 environment text not null check(environment='integration'),
 contract_version integer not null check(contract_version=1)
);
insert into dlkt_info_runtime.instance(project_ref,environment,contract_version)
values('hziavqdhsqnihxuuxzhn','integration',1);
alter table dlkt_info_runtime.instance enable row level security;
revoke all on dlkt_info_runtime.instance from public,anon,authenticated,authenticator,service_role;
grant usage on schema dlkt_info_runtime to dlkt_rt_vault,dlkt_rt_checkout,dlkt_rt_recovery,dlkt_rt_ingress,dlkt_rt_worker,dlkt_rt_reconcile,dlkt_rt_customer,dlkt_rt_closure,dlkt_rt_review,dlkt_rt_cleanup;
grant select on dlkt_info_runtime.instance to dlkt_rt_vault,dlkt_rt_checkout,dlkt_rt_recovery,dlkt_rt_ingress,dlkt_rt_worker,dlkt_rt_reconcile,dlkt_rt_customer,dlkt_rt_closure,dlkt_rt_review,dlkt_rt_cleanup;
create policy runtime_instance_read on dlkt_info_runtime.instance for select to dlkt_rt_vault,dlkt_rt_checkout,dlkt_rt_recovery,dlkt_rt_ingress,dlkt_rt_worker,dlkt_rt_reconcile,dlkt_rt_customer,dlkt_rt_closure,dlkt_rt_review,dlkt_rt_cleanup using(true);
create function dlkt_info_runtime.identity()
returns table(project_ref text,environment text,contract_version integer,login_role text,effective_role text,encrypted boolean)
language sql security invoker set search_path=pg_catalog as $$
 select i.project_ref,i.environment,i.contract_version,session_user::text,current_user::text,
 coalesce((select s.ssl from pg_catalog.pg_stat_ssl s where s.pid=pg_backend_pid()),false)
 from dlkt_info_runtime.instance i where i.singleton;
$$;
revoke all on function dlkt_info_runtime.identity() from public,anon,authenticated,authenticator,service_role;
grant execute on function dlkt_info_runtime.identity() to dlkt_rt_vault,dlkt_rt_checkout,dlkt_rt_recovery,dlkt_rt_ingress,dlkt_rt_worker,dlkt_rt_reconcile,dlkt_rt_customer,dlkt_rt_closure,dlkt_rt_review,dlkt_rt_cleanup;
do $$
declare rt text;g text;r text;s text;
begin
 foreach rt in array array['dlkt_rt_vault','dlkt_rt_checkout','dlkt_rt_recovery','dlkt_rt_ingress','dlkt_rt_worker','dlkt_rt_reconcile','dlkt_rt_customer','dlkt_rt_closure','dlkt_rt_review','dlkt_rt_cleanup'] loop
  if exists(select 1 from pg_roles where rolname=rt and (rolcanlogin or rolbypassrls or rolsuper or rolcreaterole or rolcreatedb or rolreplication)) then raise exception 'Runtime role overprivileged: %',rt;end if;
  if pg_has_role(rt,'postgres','MEMBER') or pg_has_role(rt,'service_role','MEMBER') or pg_has_role(rt,'authenticated','MEMBER') then raise exception 'Runtime role inherits broad privilege: %',rt;end if;
  if not has_function_privilege(rt,'dlkt_info_runtime.identity()','EXECUTE') then raise exception 'Runtime attestation missing: %',rt;end if;
  if exists(select 1 from pg_auth_members m join pg_roles p on p.oid=m.roleid join pg_roles u on u.oid=m.member where u.rolname=rt and (m.set_option or m.admin_option or not m.inherit_option)) then raise exception 'Unsafe capability membership: %',rt;end if;
 end loop;
 foreach r in array array['anon','authenticated','authenticator','service_role'] loop
  if has_schema_privilege(r,'dlkt_info_runtime','USAGE') or has_table_privilege(r,'dlkt_info_runtime.instance','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or has_function_privilege(r,'dlkt_info_runtime.identity()','EXECUTE') then raise exception 'Public runtime metadata grant: %',r;end if;
  if exists(select 1 from pg_roles where rolname like 'dlkt_rt_%' and pg_has_role(r,oid,'MEMBER')) then raise exception 'Broad role membership: %',r;end if;
 end loop;
 if not has_function_privilege('dlkt_rt_ingress','dlkt_info_billing.ingest_notice(text,text,text,text,bigint)','EXECUTE')
 or has_function_privilege('dlkt_rt_ingress','dlkt_info_billing.claim_notice(text)','EXECUTE')
 or not has_function_privilege('dlkt_rt_vault','dlkt_info_connection_vault.list_connections(uuid,uuid)','EXECUTE')
 or has_function_privilege('dlkt_rt_vault','dlkt_info_account_lifecycle.request_closure(uuid,uuid,uuid)','EXECUTE')
 or not has_function_privilege('dlkt_rt_checkout','dlkt_info_billing.reserve_checkout(text,uuid,text,uuid)','EXECUTE')
 or has_function_privilege('dlkt_rt_checkout','dlkt_info_billing.finish_checkout(text,uuid,uuid,text,text,text,bigint,text,text,text,text)','EXECUTE')
 or not has_function_privilege('dlkt_rt_recovery','dlkt_info_billing.finish_checkout(text,uuid,uuid,text,text,text,bigint,text,text,text,text)','EXECUTE')
 or not has_function_privilege('dlkt_rt_cleanup','dlkt_info_account_lifecycle.claim_grant_cleanup(uuid)','EXECUTE')
 or has_function_privilege('dlkt_rt_review','dlkt_info_account_lifecycle.claim_grant_cleanup(uuid)','EXECUTE')
 then raise exception 'Capability isolation mismatch';end if;
end;
$$;
