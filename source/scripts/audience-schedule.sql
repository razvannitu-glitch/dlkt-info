-- Activation runbook only; never execute in the reader database.
-- Install after reviewing the analytics project, schema and operational add-on.
create extension if not exists pg_cron;
select dlkt_audience.run_maintenance();
select cron.schedule('dlkt-audience-retention-hourly','7 * * * *','select dlkt_audience.run_maintenance();');
-- Verify a real successful scheduled run in cron.job_run_details, then verify
-- dlkt_audience.operational_ready() before setting readiness flags.
