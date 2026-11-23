-- Function-scoped resilience: prevent transient SQLSTATE 57014 on ICEO snapshot publication.
-- Verified 2026-11-23 19:15:16 UTC: /rpc/dlkt_info_publish_public_snapshot
-- timed out on the three-second PostgREST role setting; the next scheduled job
-- recovered at 19:16 UTC. Existing data and publication controls remain intact.
-- This deliberately does NOT change any role-wide or database-wide timeout.
-- Rollback: ALTER FUNCTION public.dlkt_info_publish_public_snapshot(uuid,bigint,jsonb,text) RESET statement_timeout;
BEGIN;
ALTER FUNCTION public.dlkt_info_publish_public_snapshot(uuid, bigint, jsonb, text)
  SET statement_timeout TO '12s';
COMMIT;
