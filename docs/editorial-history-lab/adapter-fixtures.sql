-- Disposable integration-test identities and credentials, never production roles.
\set ON_ERROR_STOP on
begin;
create role dlkt_history_ci_worker login inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls password 'lab-worker-local-only';
create role dlkt_history_ci_attestor login inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls password 'lab-attestor-local-only';
create role dlkt_history_ci_reader login inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls password 'lab-reader-local-only';
grant dlkt_history_worker to dlkt_history_ci_worker;
grant dlkt_history_attestor to dlkt_history_ci_attestor;
grant dlkt_history_reader to dlkt_history_ci_reader;
create role dlkt_history_ci_reviewer login inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls password 'lab-reviewer-local-only';
grant dlkt_history_reviewer to dlkt_history_ci_reviewer;
insert into dlkt_history_lab.candidates(card_id,revision,digest,source_url,policy_url)
select 'lab-adapter-'||n,1,repeat('a',64),'https://example.invalid/source/adapter-'||n,'https://example.invalid/policy/adapter-'||n
from unnest(array['positive','denied','failure','bad-receipt','start-lost','attest-lost','finish-lost','read-lost','busy','acl','before-commit','finish-before','review-scopes','review-held','review-expiry','review-corrupt']) as t(n);
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
-- Privileged test-only corruption injection: a head with missing review records.
insert into dlkt_history_lab.scope_review_heads values('lab-adapter-review-corrupt',1,repeat('a',64),'feed',1);
-- Full review journal with fewer than 256 observation attempts. All 256
-- decisions remain internally consistent and the final permission unexpired.
-- Synthetic timestamps only, relative to this disposable transaction clock.
insert into dlkt_history_lab.candidates(card_id,revision,digest,source_url,policy_url,tip)
values('lab-adapter-review-cap',1,repeat('a',64),'https://example.invalid/source/adapter-review-cap',
  'https://example.invalid/policy/adapter-review-cap',129);
insert into dlkt_history_lab.attempts
select md5(c.card_id||':'||n)::uuid,c.card_id,c.revision,c.digest,n,
  date_trunc('second',transaction_timestamp())-interval '3 hours'+n*interval '1 minute'
from dlkt_history_lab.candidates c cross join generate_series(1,129) n
where c.card_id='lab-adapter-review-cap';
insert into dlkt_history_lab.results(attempt_id,finished_at,outcome,reason,observed_at,fingerprints,evidence_digest)
select a.attempt_id,a.started_at+interval '3 seconds','observed',null,
  a.started_at+interval '1 second',f,
  dlkt_history_lab.observation_digest(a.card_id,a.revision,a.digest,c.source_url,c.policy_url,a.started_at+interval '1 second',f)
from dlkt_history_lab.attempts a join dlkt_history_lab.candidates c using(card_id,revision,digest)
cross join (select to_jsonb(array[repeat('b',64),repeat('c',64),repeat('d',64),repeat('e',64),repeat('f',64)]) f) fixture
where a.card_id='lab-adapter-review-cap';
insert into dlkt_history_lab.observation_attestations
select r.attempt_id,r.evidence_digest,r.observed_at,r.observed_at+interval '1 second'
from dlkt_history_lab.results r join dlkt_history_lab.attempts a using(attempt_id)
where a.card_id='lab-adapter-review-cap';
insert into dlkt_history_lab.scope_review_heads values('lab-adapter-review-cap',1,repeat('a',64),'feed',256);
insert into dlkt_history_lab.scope_reviews
select md5(a.card_id||':feed:permit:'||a.sequence_no)::uuid,a.card_id,a.revision,a.digest,'feed',
  case when a.sequence_no<=128 then a.sequence_no*2-1 else 256 end,
  a.attempt_id,'lab-permitted',r.evidence_digest,a.started_at+interval '4 seconds',
  a.started_at+interval '23 hours','dlkt_history_ci_reviewer'::name
from dlkt_history_lab.attempts a join dlkt_history_lab.results r using(attempt_id)
where a.card_id='lab-adapter-review-cap'
union all
select md5(a.card_id||':feed:hold:'||a.sequence_no)::uuid,a.card_id,a.revision,a.digest,'feed',
  a.sequence_no*2,a.attempt_id,'lab-held',r.evidence_digest,a.started_at+interval '5 seconds',
  null::timestamptz,'dlkt_history_ci_reviewer'::name
from dlkt_history_lab.attempts a join dlkt_history_lab.results r using(attempt_id)
where a.card_id='lab-adapter-review-cap' and a.sequence_no<=127;
commit;
