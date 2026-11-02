-- Match Auth's 12-character minimum on every atomic password-writing path.
-- Replace only the length check; preserve installed guards, grants and hashing.
DO $migration$
DECLARE
  v_function record;
  v_definition text;
  v_updated text;
  v_count integer := 0;
BEGIN
  FOR v_function IN
    SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'account_recovery'
      AND p.proname IN ('recovery_complete_impl', 'admin_reset_password_impl', 'self_change_password_impl')
  LOOP
    v_definition := pg_get_functiondef(v_function.oid);
    v_updated := replace(replace(v_definition,
      'char_length(p_password) < 6', 'char_length(p_password) < 12'),
      'char_length(p_new_password) < 6', 'char_length(p_new_password) < 12');
    IF v_updated = v_definition THEN
      RAISE EXCEPTION 'Expected password length guard missing in %', v_function.oid::regprocedure;
    END IF;
    EXECUTE v_updated;
    v_count := v_count + 1;
  END LOOP;
  IF v_count <> 3 THEN RAISE EXCEPTION 'Expected three atomic password functions, found %', v_count; END IF;
END
$migration$;
NOTIFY pgrst, 'reload schema';
