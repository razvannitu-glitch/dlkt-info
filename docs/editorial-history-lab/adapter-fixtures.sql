-- Disposable integration-test identities and credentials, never production roles.
\set ON_ERROR_STOP on
begin;
create role dlkt_history_ci_worker login inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls password 'lab-worker-local-only';
create role dlkt_history_ci_attestor login inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls password 'lab-attestor-local-only';
create role dlkt_history_ci_reader login inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls password 'lab-reader-local-only';
grant dlkt_history_worker to dlkt_history_ci_worker;
grant dlkt_history_attestor to dlkt_history_ci_attestor;
grant dlkt_history_reader to dlkt_history_ci_reader;
insert into dlkt_history_lab.candidates(card_id,revision,digest,source_url,policy_url)
select 'lab-adapter-'||n,1,repeat('a',64),'https://example.invalid/source/adapter-'||n,'https://example.invalid/policy/adapter-'||n
from unnest(array['positive','denied','failure','bad-receipt','start-lost','attest-lost','finish-lost','read-lost','busy','acl','before-commit','finish-before']) as t(n);
insert into dlkt_history_lab.candidates(card_id,revision,digest,source_url,policy_url)
values('dlkt-elsewhere-nsw-fuelcheck',1,'772d754d42ceb10260b4c02c1b4c97fcb1949ddbf61d6b0cd17fb2b88fa1c88b','https://www.nsw.gov.au/legal-and-justice/consumer-rights-and-protection/advertising-product-packaging-and-pricing-laws/fuel-pricing-discounts-and-signage/check-fuel-prices','https://www.nsw.gov.au/nsw-government/about-website/copyright');
-- The final reviewed candidate must remain excluded from this laboratory.
do $$
begin
  begin
    insert into dlkt_history_lab.candidates(card_id,revision,digest,source_url,policy_url)
    values('dlkt-elsewhere-nsw-fuelcheck',1,'d4c1df98ae87865402292c04c46811d60eee7ed3bde9583f1e16cd243611110e','https://www.nsw.gov.au/legal-and-justice/consumer-rights-and-protection/advertising-product-packaging-and-pricing-laws/fuel-pricing-discounts-and-signage/check-fuel-prices','https://www.nsw.gov.au/nsw-government/about-website/copyright');
    raise exception 'actual admission identity allowed in laboratory';
  exception when check_violation then null; end;
end;
$$;
commit;
