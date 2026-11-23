-- Scoped availability fix for the production database readiness attestation.
-- PostgreSQL anon sessions default to a 3s statement timeout; this metadata-heavy
-- RPC has repeatedly been cancelled with SQLSTATE 57014 during Vercel builds.
-- This is NOT a global or role-wide timeout change. Exact function identity only.
-- No grants, policies, table data, functions bodies, or readiness checks changed.
-- Rollback: ALTER FUNCTION public.dlkt_info_read_database_readiness() RESET statement_timeout;
BEGIN;
ALTER FUNCTION public.dlkt_info_read_database_readiness()
  SET statement_timeout TO '12s';
COMMIT;
