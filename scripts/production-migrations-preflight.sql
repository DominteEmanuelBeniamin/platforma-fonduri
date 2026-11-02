-- Read-only deployment gate. The initial CIF rollout requires coordinated application,
-- not an automatic db push. See docs/issue-110-rollout.md.
DO $preflight$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261029130000') THEN
    RAISE EXCEPTION 'CIF_ROLLOUT_REQUIRED: apply the coordinated CIF rollout and register migration 20261029130000 before automatic deployment; see docs/issue-110-rollout.md';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='creation_pending')
    OR to_regprocedure('account_creation.normalize_cif(text)') IS NULL
    OR NOT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.profiles_cif_unique') AND indisunique AND indisvalid) THEN
    RAISE EXCEPTION 'CIF_SCHEMA_INCOMPLETE: migration history and schema disagree; automatic deployment stopped';
  END IF;
END
$preflight$;
