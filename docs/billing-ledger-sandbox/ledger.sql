-- Isolated candidate only. DO NOT APPLY TO PRODUCTION.
-- No migration registration, public RPC, Stripe calls or entitlement grants.
begin;
create schema dlkt_info_billing;
revoke all on schema dlkt_info_billing from public, anon, authenticated, service_role;
grant usage on schema dlkt_info_billing to service_role;

create table dlkt_info_billing.catalog_accounts (
  account_id text primary key check (account_id ~ '^acct_[A-Za-z0-9]{1,250}$'),
  product_id text not null check (product_id ~ '^prod_[A-Za-z0-9]{1,250}$'),
  live_mode boolean not null default false check (live_mode = false)
);
create table dlkt_info_billing.catalog_prices (
  account_id text not null references dlkt_info_billing.catalog_accounts(account_id),
  price_id text not null check (price_id ~ '^price_[A-Za-z0-9]{1,249}$'),
  plan text not null check (plan in ('monthly','annual')),
  amount_cents integer not null,
  currency text not null default 'eur' check (currency = 'eur'),
  primary key (account_id, price_id),
  unique (account_id, plan),
  check ((plan = 'monthly' and amount_cents = 699) or (plan = 'annual' and amount_cents = 6900))
);
create table dlkt_info_billing.customer_bindings (
  account_id text not null references dlkt_info_billing.catalog_accounts(account_id),
  customer_id text not null check (customer_id ~ '^cus_[A-Za-z0-9]{1,251}$'),
  owner_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (account_id, customer_id),
  unique (account_id, owner_id)
);
-- Preserve an unassignable tombstone on Auth deletion; no runtime update/delete grant.
-- Retention/cancellation orchestration is a separate release gate.
create function dlkt_info_billing.require_initial_owner() returns trigger
language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if new.owner_id is null then
    raise exception using errcode = '23502', message = 'BILLING_OWNER_REQUIRED';
  end if;
  return new;
end;
$$;
revoke all on function dlkt_info_billing.require_initial_owner() from public, anon, authenticated, service_role;
create trigger require_initial_owner before insert on dlkt_info_billing.customer_bindings
for each row execute function dlkt_info_billing.require_initial_owner();

create table dlkt_info_billing.subscription_bindings (
  account_id text not null,
  customer_id text not null,
  subscription_id text not null check (subscription_id ~ '^sub_[A-Za-z0-9]{1,251}$'),
  price_id text not null,
  item_id text not null check (item_id ~ '^si_[A-Za-z0-9]{1,252}$'),
  created_at timestamptz not null default clock_timestamp(),
  primary key (account_id, subscription_id),
  unique (account_id, item_id),
  foreign key (account_id, customer_id) references dlkt_info_billing.customer_bindings(account_id, customer_id),
  foreign key (account_id, price_id) references dlkt_info_billing.catalog_prices(account_id, price_id)
);
create index subscription_bindings_customer_idx on dlkt_info_billing.subscription_bindings(account_id, customer_id);

-- This increment reserves a single checkout slot. It deliberately cannot close or
-- reuse a slot from the application role: verified terminal transitions are not built yet.
create table dlkt_info_billing.checkout_intents (
  intent_id uuid primary key,
  account_id text not null,
  customer_id text not null,
  price_id text not null,
  created_at timestamptz not null default clock_timestamp(),
  closed_at timestamptz,
  foreign key (account_id, customer_id) references dlkt_info_billing.customer_bindings(account_id, customer_id),
  foreign key (account_id, price_id) references dlkt_info_billing.catalog_prices(account_id, price_id),
  check (closed_at is null or closed_at >= created_at)
);
create unique index checkout_intents_one_open_idx
on dlkt_info_billing.checkout_intents(account_id, customer_id) where closed_at is null;

-- Persist only deduplication identity and validated routing metadata. No raw payload,
-- secret, customer email, payment card or entitlement evidence.
create table dlkt_info_billing.event_notices (
  account_id text not null references dlkt_info_billing.catalog_accounts(account_id),
  event_id text not null check (event_id ~ '^evt_[A-Za-z0-9]{1,251}$'),
  event_type text not null check (event_type in (
    'checkout.session.completed','checkout.session.async_payment_succeeded',
    'checkout.session.async_payment_failed','checkout.session.expired',
    'customer.subscription.created','customer.subscription.updated',
    'customer.subscription.deleted','customer.subscription.paused',
    'customer.subscription.resumed','invoice.paid','invoice.payment_failed',
    'charge.refunded','charge.dispute.created','radar.early_fraud_warning.created'
  )),
  object_id text not null check (length(object_id) <= 255),
  event_created bigint not null check (event_created between 1 and 253402300799),
  received_at timestamptz not null default clock_timestamp(),
  primary key (account_id, event_id),
  check (
    (event_type like 'checkout.session.%' and object_id ~ '^cs_test_[A-Za-z0-9]+$') or
    (event_type like 'customer.subscription.%' and object_id ~ '^sub_[A-Za-z0-9]+$') or
    (event_type like 'invoice.%' and object_id ~ '^in_[A-Za-z0-9]+$') or
    (event_type = 'charge.refunded' and object_id ~ '^ch_[A-Za-z0-9]+$') or
    (event_type = 'charge.dispute.created' and object_id ~ '^dp_[A-Za-z0-9]+$') or
    (event_type = 'radar.early_fraud_warning.created' and object_id ~ '^issfr_[A-Za-z0-9]+$')
  )
);
alter table dlkt_info_billing.catalog_accounts enable row level security;
alter table dlkt_info_billing.catalog_prices enable row level security;
alter table dlkt_info_billing.customer_bindings enable row level security;
alter table dlkt_info_billing.subscription_bindings enable row level security;
alter table dlkt_info_billing.checkout_intents enable row level security;
alter table dlkt_info_billing.event_notices enable row level security;
revoke all on all tables in schema dlkt_info_billing from public, anon, authenticated, service_role;
grant select on all tables in schema dlkt_info_billing to service_role;
grant insert (account_id, customer_id, owner_id) on dlkt_info_billing.customer_bindings to service_role;
grant insert (account_id, customer_id, subscription_id, price_id, item_id) on dlkt_info_billing.subscription_bindings to service_role;
grant insert (intent_id, account_id, customer_id, price_id) on dlkt_info_billing.checkout_intents to service_role;
grant insert (account_id, event_id, event_type, object_id, event_created) on dlkt_info_billing.event_notices to service_role;
commit;
