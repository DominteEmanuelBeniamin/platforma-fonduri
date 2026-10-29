-- Requires the TypeScript preflight fingerprint in the same SQL session.
-- Never apply before coordinated rollout of the phase 3 account routes.
BEGIN;
SET LOCAL lock_timeout = '10s';
SELECT pg_advisory_xact_lock(105, 1);
LOCK TABLE public.profiles IN ACCESS EXCLUSIVE MODE;

DO $preflight$
DECLARE v_fingerprint text;
BEGIN
  SELECT md5(coalesce(jsonb_agg(jsonb_build_array(id, role, cif) ORDER BY id), '[]'::jsonb)::text)
    INTO v_fingerprint FROM public.profiles;
  IF current_setting('app.issue110_cif_preflight', true) IS DISTINCT FROM v_fingerprint THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CIF_PREFLIGHT_REQUIRED';
  END IF;
END
$preflight$;

CREATE SCHEMA account_creation;
REVOKE ALL ON SCHEMA account_creation FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA account_creation TO service_role;

-- Identity only: the full EU formats and RO checksum stay in lib/cif.ts.
CREATE FUNCTION account_creation.normalize_cif(p_cif text)
RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT SECURITY INVOKER SET search_path = pg_catalog
AS $fn$
DECLARE v_value text; v_prefix text; v_number text;
BEGIN
  -- Match JavaScript whitespace, including NBSP and pasted Unicode spaces.
  v_value := translate(p_cif, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF.', '');
  IF v_value = '' THEN RETURN NULL; END IF;
  IF v_value !~ '^[A-Za-z0-9+*]+$' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CIF_INVALID';
  END IF;
  v_value := upper(v_value);
  IF v_value ~ '^[A-Z]{2}' THEN
    v_prefix := left(v_value, 2);
    v_number := substr(v_value, 3);
  ELSE
    v_prefix := 'RO'; v_number := v_value;
  END IF;
  IF v_prefix = 'GR' THEN v_prefix := 'EL'; END IF;
  IF v_prefix <> ALL(ARRAY['RO','AT','BE','BG','CZ','CY','HR','DK','EE','FI','FR','DE','EL','IE','IT','LV','LT','LU','MT','PL','PT','SK','SI','ES','SE','NL','HU']) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CIF_COUNTRY_UNSUPPORTED';
  END IF;
  IF v_prefix = 'RO' THEN
    v_number := ltrim(v_number, '0');
    IF v_number !~ '^[0-9]{2,10}$' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CIF_INVALID';
    END IF;
  END IF;
  IF v_number = '' THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CIF_REQUIRED'; END IF;
  RETURN v_prefix || v_number;
END
$fn$;
REVOKE ALL ON FUNCTION account_creation.normalize_cif(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION account_creation.normalize_cif(text) TO service_role;

DO $canonical$
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles WHERE
    (role = 'client' AND nullif(btrim(cif), '') IS NULL)
    OR (cif IS NOT NULL AND (account_creation.normalize_cif(cif) IS NULL OR cif IS DISTINCT FROM account_creation.normalize_cif(cif)))) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CIF_PREFLIGHT_INVALID';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE cif IS NOT NULL GROUP BY cif HAVING count(*) > 1) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CIF_PREFLIGHT_DUPLICATE';
  END IF;
END
$canonical$;

ALTER TABLE public.profiles ADD COLUMN creation_pending boolean NOT NULL DEFAULT false;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_pending_inactive CHECK (NOT creation_pending OR NOT is_active),
  ADD CONSTRAINT profiles_final_client_cif CHECK (creation_pending OR role <> 'client' OR nullif(btrim(cif), '') IS NOT NULL),
  ADD CONSTRAINT profiles_cif_canonical CHECK (cif IS NULL OR (account_creation.normalize_cif(cif) IS NOT NULL AND cif = account_creation.normalize_cif(cif)));
CREATE UNIQUE INDEX profiles_cif_unique ON public.profiles(cif) WHERE cif IS NOT NULL;

CREATE FUNCTION account_creation.normalize_profile_cif()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $fn$
BEGIN
  NEW.cif := account_creation.normalize_cif(NEW.cif);
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION account_creation.normalize_profile_cif() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER normalize_profile_cif BEFORE INSERT OR UPDATE OF cif ON public.profiles
FOR EACH ROW EXECUTE FUNCTION account_creation.normalize_profile_cif();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
BEGIN
  INSERT INTO public.profiles(id, email, full_name, role, creation_pending, is_active)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name', 'client', true, false);
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.finalize_new_user_account(
  p_target_id uuid, p_actor_id uuid, p_expected_ban timestamptz, p_role text,
  p_cif text DEFAULT NULL, p_profile jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
DECLARE v_actor public.profiles%ROWTYPE; v_target public.profiles%ROWTYPE; v_ban timestamptz; v_cif text;
BEGIN
  PERFORM pg_advisory_xact_lock(105, 1);
  PERFORM p.id FROM public.profiles p WHERE p.id IN (p_actor_id, p_target_id) ORDER BY p.id FOR UPDATE;
  SELECT * INTO v_actor FROM public.profiles WHERE id = p_actor_id;
  IF NOT FOUND OR v_actor.role <> 'admin' OR v_actor.is_active IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACTIVE_ADMIN_REQUIRED';
  END IF;
  SELECT * INTO v_target FROM public.profiles WHERE id = p_target_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'USER_NOT_FOUND'; END IF;
  IF NOT v_target.creation_pending OR v_target.is_active THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACCOUNT_CREATION_NOT_PENDING';
  END IF;
  IF p_role IS NULL OR p_role NOT IN ('client', 'consultant', 'admin')
    OR p_profile IS NULL OR jsonb_typeof(p_profile) <> 'object' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_PROFILE_PATCH';
  END IF;
  IF p_profile - ARRAY['full_name','telefon','nume_firma','adresa_firma','persoana_contact','departament','specializare','consultant_level']::text[] <> '{}'::jsonb
    OR EXISTS (SELECT 1 FROM jsonb_each(p_profile) e WHERE jsonb_typeof(e.value) NOT IN ('string','null'))
    OR (p_profile ? 'full_name' AND (jsonb_typeof(p_profile->'full_name') <> 'string' OR nullif(btrim(p_profile->>'full_name'), '') IS NULL))
    OR (p_profile ? 'consultant_level' AND (p_role <> 'consultant' OR (p_profile->>'consultant_level') IS NULL OR p_profile->>'consultant_level' NOT IN ('junior','senior'))) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_PROFILE_PATCH';
  END IF;
  v_cif := account_creation.normalize_cif(p_cif);
  IF p_role = 'client' AND v_cif IS NULL THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CIF_REQUIRED'; END IF;
  IF p_role <> 'client' AND p_cif IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CIF_FORBIDDEN'; END IF;
  SELECT banned_until INTO v_ban FROM auth.users WHERE id = p_target_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'USER_NOT_FOUND'; END IF;
  IF p_expected_ban IS NULL OR v_ban IS DISTINCT FROM p_expected_ban THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACCOUNT_CREATION_BAN_CHANGED';
  END IF;
  UPDATE public.profiles SET role = p_role, cif = v_cif,
    full_name = CASE WHEN p_profile ? 'full_name' THEN p_profile->>'full_name' ELSE full_name END,
    telefon = p_profile->>'telefon', nume_firma = p_profile->>'nume_firma', adresa_firma = p_profile->>'adresa_firma',
    persoana_contact = p_profile->>'persoana_contact', departament = p_profile->>'departament', specializare = p_profile->>'specializare',
    consultant_level = coalesce(p_profile->>'consultant_level', 'junior'),
    must_change_password = true, creation_pending = false, is_active = true, updated_at = clock_timestamp()
  WHERE id = p_target_id;
  UPDATE auth.users SET banned_until = NULL WHERE id = p_target_id;
  RETURN jsonb_build_object('finalized', true, 'userId', p_target_id);
END
$fn$;
REVOKE ALL ON FUNCTION public.finalize_new_user_account(uuid,uuid,timestamptz,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_new_user_account(uuid,uuid,timestamptz,text,text,jsonb) TO service_role;

CREATE FUNCTION public.cancel_new_user_account(p_target_id uuid, p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
BEGIN
  PERFORM pg_advisory_xact_lock(105, 1);
  PERFORM p.id FROM public.profiles p WHERE p.id IN (p_actor_id, p_target_id) ORDER BY p.id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_target_id AND creation_pending) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACCOUNT_CREATION_NOT_PENDING';
  END IF;
  RETURN public.delete_empty_user_account(p_target_id, p_actor_id, NULL, 'account-creation-compensation');
END
$fn$;
REVOKE ALL ON FUNCTION public.cancel_new_user_account(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_new_user_account(uuid,uuid) TO service_role;

-- Retain the entire #105 lifecycle implementation; insert one checked guard.
DO $lifecycle$
DECLARE v_source text; v_anchor text := 'SELECT * INTO v_target FROM public.profiles WHERE id = p_target_id;';
BEGIN
  SELECT pg_get_functiondef('public.set_user_account_active(uuid,uuid,boolean,text,text)'::regprocedure) INTO v_source;
  IF array_length(string_to_array(v_source, v_anchor), 1) <> 2 THEN RAISE EXCEPTION 'Unrecognized account lifecycle definition'; END IF;
  EXECUTE replace(v_source, v_anchor, v_anchor || '
    IF FOUND AND v_target.creation_pending THEN
      RAISE EXCEPTION USING ERRCODE = ''P0001'', MESSAGE = ''ACCOUNT_CREATION_PENDING'';
    END IF;');
END
$lifecycle$;

CREATE OR REPLACE FUNCTION public.update_user_profile_guarded(p_target_id uuid, p_actor_id uuid, p_changes jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
DECLARE
  v_actor public.profiles%ROWTYPE; v_target public.profiles%ROWTYPE;
  v_full_name text; v_role text; v_telefon text; v_cif text; v_consultant_level text;
  v_before jsonb; v_after jsonb; v_old_values jsonb; v_new_values jsonb; v_profile jsonb;
BEGIN
  IF p_target_id IS NULL OR p_actor_id IS NULL OR p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object'
    OR p_changes = '{}'::jsonb OR p_changes - ARRAY['full_name','role','telefon','cif','consultant_level']::text[] <> '{}'::jsonb THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_PROFILE_PATCH';
  END IF;
  PERFORM pg_advisory_xact_lock(105, 1);
  PERFORM p.id FROM public.profiles p WHERE p.id IN (p_actor_id, p_target_id) ORDER BY p.id FOR UPDATE;
  SELECT * INTO v_actor FROM public.profiles WHERE id = p_actor_id;
  IF NOT FOUND OR v_actor.is_active IS NOT TRUE OR (p_actor_id <> p_target_id AND v_actor.role <> 'admin') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACTIVE_ADMIN_REQUIRED';
  END IF;
  IF p_changes ? 'cif' AND v_actor.role <> 'admin' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CIF_FORBIDDEN';
  END IF;
  IF (p_changes ? 'role' OR p_changes ? 'consultant_level') AND v_actor.role <> 'admin' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACTIVE_ADMIN_REQUIRED';
  END IF;
  SELECT * INTO v_target FROM public.profiles WHERE id = p_target_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'USER_NOT_FOUND'; END IF;
  IF v_target.creation_pending THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACCOUNT_CREATION_PENDING'; END IF;

  v_full_name := CASE WHEN p_changes ? 'full_name' THEN p_changes->>'full_name' ELSE v_target.full_name END;
  v_role := CASE WHEN p_changes ? 'role' THEN p_changes->>'role' ELSE v_target.role END;
  v_telefon := CASE WHEN p_changes ? 'telefon' THEN p_changes->>'telefon' ELSE v_target.telefon END;
  v_cif := CASE WHEN p_changes ? 'cif' THEN p_changes->>'cif' ELSE v_target.cif END;
  v_consultant_level := CASE WHEN p_changes ? 'consultant_level' THEN p_changes->>'consultant_level' ELSE v_target.consultant_level END;
  IF (p_changes ? 'full_name' AND (jsonb_typeof(p_changes->'full_name') <> 'string' OR nullif(btrim(v_full_name), '') IS NULL))
    OR (p_changes ? 'role' AND (jsonb_typeof(p_changes->'role') <> 'string' OR v_role NOT IN ('admin','client','consultant')))
    OR (p_changes ? 'consultant_level' AND (jsonb_typeof(p_changes->'consultant_level') <> 'string' OR v_consultant_level NOT IN ('junior','senior')))
    OR (p_changes ? 'telefon' AND jsonb_typeof(p_changes->'telefon') NOT IN ('string','null'))
    OR (p_changes ? 'cif' AND jsonb_typeof(p_changes->'cif') NOT IN ('string','null')) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_PROFILE_PATCH';
  END IF;
  IF p_changes ? 'cif' AND v_role <> 'client' THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CIF_FORBIDDEN'; END IF;
  v_cif := account_creation.normalize_cif(v_cif);
  IF v_role = 'client' AND v_cif IS NULL THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CIF_REQUIRED'; END IF;
  IF v_role <> 'consultant' AND p_changes ? 'consultant_level' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_PROFILE_PATCH';
  END IF;
  IF v_role <> 'consultant' THEN v_consultant_level := 'junior'; END IF;
  IF v_target.is_active AND v_target.role = 'admin' AND v_role <> 'admin'
    AND (SELECT count(*) FROM public.profiles WHERE role = 'admin' AND is_active) <= 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LAST_ACTIVE_ADMIN';
  END IF;

  v_before := jsonb_build_object('full_name',v_target.full_name,'role',v_target.role,'telefon',v_target.telefon,'cif',v_target.cif,'consultant_level',v_target.consultant_level);
  v_after := jsonb_build_object('full_name',v_full_name,'role',v_role,'telefon',v_telefon,'cif',v_cif,'consultant_level',v_consultant_level);
  SELECT coalesce(jsonb_object_agg(e.key,e.value),'{}'::jsonb), coalesce(jsonb_object_agg(e.key,v_after->e.key),'{}'::jsonb)
    INTO v_old_values,v_new_values FROM jsonb_each(v_before) e WHERE e.value IS DISTINCT FROM v_after->e.key;
  IF v_before IS DISTINCT FROM v_after THEN
    UPDATE public.profiles SET full_name=v_full_name,role=v_role,telefon=v_telefon,cif=v_cif,consultant_level=v_consultant_level,updated_at=clock_timestamp() WHERE id=p_target_id;
  END IF;
  SELECT jsonb_build_object('id',p.id,'email',p.email,'full_name',p.full_name,'role',p.role,'consultant_level',p.consultant_level,
    'telefon',p.telefon,'cif',p.cif,'nume_firma',p.nume_firma,'adresa_firma',p.adresa_firma,'departament',p.departament,
    'specializare',p.specializare,'is_active',p.is_active,'auth_sync_pending',p.auth_sync_pending,'creation_pending',p.creation_pending)
    INTO v_profile FROM public.profiles p WHERE id=p_target_id;
  RETURN jsonb_build_object('profile',v_profile,'changed',v_before IS DISTINCT FROM v_after,'oldValues',v_old_values,'newValues',v_new_values);
END
$fn$;
REVOKE ALL ON FUNCTION public.update_user_profile_guarded(uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_user_profile_guarded(uuid,uuid,jsonb) TO service_role;
REVOKE INSERT, UPDATE, DELETE ON public.profiles FROM anon, authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
