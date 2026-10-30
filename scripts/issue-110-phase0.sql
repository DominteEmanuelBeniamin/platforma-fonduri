-- Local prototype only. The runner installs this in its disposable database.
-- Full CIF validation and the deployable migration belong to later phases.
ALTER TABLE public.profiles ADD COLUMN creation_pending boolean NOT NULL DEFAULT false;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_pending_inactive CHECK (NOT creation_pending OR NOT is_active),
  ADD CONSTRAINT profiles_final_client_cif CHECK (
    creation_pending OR role <> 'client' OR nullif(btrim(cif), '') IS NOT NULL
  );
CREATE UNIQUE INDEX profiles_cif_unique ON public.profiles(cif) WHERE cif IS NOT NULL;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
BEGIN
  INSERT INTO public.profiles(id, email, full_name, role, creation_pending, is_active)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name', 'client', true, false);
  RETURN NEW;
END
$fn$;

CREATE FUNCTION public.phase0_finalize_new_user(
  p_target_id uuid, p_actor_id uuid, p_expected_ban timestamptz, p_role text, p_cif text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
DECLARE
  v_actor public.profiles%ROWTYPE;
  v_target public.profiles%ROWTYPE;
  v_ban timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(105, 1);
  PERFORM p.id FROM public.profiles AS p
  WHERE p.id IN (p_actor_id, p_target_id) ORDER BY p.id FOR UPDATE;
  SELECT * INTO v_actor FROM public.profiles WHERE id = p_actor_id;
  IF NOT FOUND OR v_actor.role <> 'admin' OR v_actor.is_active IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACTIVE_ADMIN_REQUIRED';
  END IF;
  SELECT * INTO v_target FROM public.profiles WHERE id = p_target_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'USER_NOT_FOUND';
  END IF;
  IF NOT v_target.creation_pending OR v_target.is_active THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACCOUNT_CREATION_NOT_PENDING';
  END IF;
  IF p_role IS NULL OR p_role NOT IN ('client', 'consultant', 'admin')
     OR (p_role = 'client' AND (p_cif IS NULL OR p_cif !~ '^RO[0-9]{2,10}$'))
     OR (p_role <> 'client' AND p_cif IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_PROFILE_PATCH';
  END IF;
  SELECT u.banned_until INTO v_ban FROM auth.users AS u WHERE u.id = p_target_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'USER_NOT_FOUND';
  END IF;
  -- Match the exact ban returned by createUser; never clear a replacement ban.
  IF p_expected_ban IS NULL OR v_ban IS DISTINCT FROM p_expected_ban THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACCOUNT_CREATION_BAN_CHANGED';
  END IF;
  UPDATE public.profiles SET role = p_role, cif = p_cif,
    full_name = 'Issue 110 local probe', must_change_password = true,
    creation_pending = false, is_active = true
  WHERE id = p_target_id;
  UPDATE auth.users SET banned_until = NULL WHERE id = p_target_id;
  RETURN jsonb_build_object('finalized', true, 'userId', p_target_id);
END
$fn$;
REVOKE ALL ON FUNCTION public.phase0_finalize_new_user(uuid, uuid, timestamptz, text, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase0_finalize_new_user(uuid, uuid, timestamptz, text, text) TO service_role;

-- Extend the existing guarded functions without changing historical migrations.
DO $install$
DECLARE v_signature regprocedure; v_definition text; v_extended text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.set_user_account_active(uuid,uuid,boolean,text,text)'::regprocedure,
    'public.update_user_profile_guarded(uuid,uuid,jsonb)'::regprocedure
  ] LOOP
    v_definition := pg_get_functiondef(v_signature);
    v_extended := replace(v_definition,
      'SELECT * INTO v_target FROM public.profiles WHERE id = p_target_id;',
      'SELECT * INTO v_target FROM public.profiles WHERE id = p_target_id;
       IF FOUND AND v_target.creation_pending THEN
         RAISE EXCEPTION USING ERRCODE = ''P0001'', MESSAGE = ''ACCOUNT_CREATION_PENDING'';
       END IF;');
    IF v_extended = v_definition THEN RAISE EXCEPTION 'Unrecognized lifecycle function'; END IF;
    EXECUTE v_extended;
  END LOOP;
END
$install$;

CREATE FUNCTION public.phase0_cancel_new_user(p_target_id uuid, p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
BEGIN
  PERFORM pg_advisory_xact_lock(105, 1);
  PERFORM p.id FROM public.profiles AS p
  WHERE p.id IN (p_actor_id, p_target_id) ORDER BY p.id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_target_id AND creation_pending) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACCOUNT_CREATION_NOT_PENDING';
  END IF;
  RETURN public.delete_empty_user_account(p_target_id, p_actor_id, NULL, 'issue110-phase0');
END
$fn$;
REVOKE ALL ON FUNCTION public.phase0_cancel_new_user(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase0_cancel_new_user(uuid, uuid) TO service_role;

-- Fault injection is private and exists only in this disposable database.
CREATE SCHEMA issue110_probe;
REVOKE ALL ON SCHEMA issue110_probe FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE issue110_probe.faults(target_id uuid PRIMARY KEY, stage text NOT NULL);
CREATE TABLE issue110_probe.barriers(name text PRIMARY KEY, released boolean NOT NULL DEFAULT false);
CREATE FUNCTION issue110_probe.auth_fault()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM issue110_probe.faults WHERE target_id = OLD.id
    AND stage = CASE WHEN TG_OP = 'DELETE' THEN 'cleanup' ELSE 'unban' END) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PROBE_INJECTED_FAILURE';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION issue110_probe.auth_fault() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER issue110_probe_unban BEFORE UPDATE OF banned_until ON auth.users
FOR EACH ROW EXECUTE FUNCTION issue110_probe.auth_fault();
CREATE TRIGGER issue110_probe_cleanup BEFORE DELETE ON auth.users
FOR EACH ROW EXECUTE FUNCTION issue110_probe.auth_fault();
NOTIFY pgrst, 'reload schema';
