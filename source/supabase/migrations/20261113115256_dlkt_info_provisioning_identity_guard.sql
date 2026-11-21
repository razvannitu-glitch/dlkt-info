begin;

create table if not exists dlkt_info_private.system_identity (
  singleton boolean primary key default true,
  instance_id uuid not null default gen_random_uuid() unique,
  product_id text not null,
  engine_id text not null,
  data_foundation_version text not null,
  persistence_version text not null,
  schema_revision text not null,
  data_region text not null,
  dedicated boolean not null default true,
  automatic_execution boolean not null default false,
  public_cards_enabled boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint dlkt_info_system_identity_singleton_check check (singleton),
  constraint dlkt_info_system_identity_product_check check (product_id = 'dlkt-info'),
  constraint dlkt_info_system_identity_engine_check check (engine_id = 'dlkt-info-inphocore-engine-orchestra'),
  constraint dlkt_info_system_identity_foundation_check check (data_foundation_version = 'dlkt-info-data-1'),
  constraint dlkt_info_system_identity_persistence_check check (persistence_version = 'dlkt-info-persistence-2'),
  constraint dlkt_info_system_identity_revision_check check (schema_revision = '20261113115256_dlkt_info_provisioning_identity_guard'),
  constraint dlkt_info_system_identity_region_check check (data_region = 'eu-central-1'),
  constraint dlkt_info_system_identity_dedicated_check check (dedicated),
  constraint dlkt_info_system_identity_automatic_check check (not automatic_execution),
  constraint dlkt_info_system_identity_public_cards_check check (not public_cards_enabled)
);

revoke all on table dlkt_info_private.system_identity from public, anon, authenticated;
grant select, insert, update on table dlkt_info_private.system_identity to service_role;

insert into dlkt_info_private.system_identity (
  singleton,
  product_id,
  engine_id,
  data_foundation_version,
  persistence_version,
  schema_revision,
  data_region,
  dedicated,
  automatic_execution,
  public_cards_enabled
) values (
  true,
  'dlkt-info',
  'dlkt-info-inphocore-engine-orchestra',
  'dlkt-info-data-1',
  'dlkt-info-persistence-2',
  '20261113115256_dlkt_info_provisioning_identity_guard',
  'eu-central-1',
  true,
  false,
  false
)
on conflict (singleton) do update
set product_id = excluded.product_id,
    engine_id = excluded.engine_id,
    data_foundation_version = excluded.data_foundation_version,
    persistence_version = excluded.persistence_version,
    schema_revision = excluded.schema_revision,
    data_region = excluded.data_region,
    dedicated = excluded.dedicated,
    automatic_execution = excluded.automatic_execution,
    public_cards_enabled = excluded.public_cards_enabled,
    updated_at = clock_timestamp();

create or replace function public.dlkt_info_read_system_identity()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, dlkt_info_private
as $$
  select jsonb_build_object(
    'version', 'dlkt-info-system-identity-1',
    'instanceId', identity.instance_id,
    'productId', identity.product_id,
    'engineId', identity.engine_id,
    'dataFoundationVersion', identity.data_foundation_version,
    'persistenceVersion', identity.persistence_version,
    'schemaRevision', identity.schema_revision,
    'dataRegion', identity.data_region,
    'dedicated', identity.dedicated,
    'automaticExecution', identity.automatic_execution,
    'publicCardsEnabled', identity.public_cards_enabled
  )
  from dlkt_info_private.system_identity as identity
  where identity.singleton;
$$;

revoke all on function public.dlkt_info_read_system_identity() from public;
grant execute on function public.dlkt_info_read_system_identity() to anon, authenticated, service_role;

comment on table dlkt_info_private.system_identity is
  'Private singleton binding one database instance to the independent DLKT Info product and expected EU data region.';
comment on function public.dlkt_info_read_system_identity() is
  'Returns a non-secret, strictly bounded database identity used to fail closed before DLKT Info Auth or Persistence can activate.';

commit;
