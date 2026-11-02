-- Adminul modifică orice dată a unui cont: emailul de autentificare, numele,
-- telefonul, CIF-ul, firma și adresa ei, departamentul și specializarea.
-- Doar adminul: până acum oricine își putea schimba prin API numele și
-- telefonul, deși nicio pagină nu o oferea.
--
-- Emailul stă și în auth.users (cu el se intră în cont) și în profiles; #107 și
-- #108 cer ca cele două să fie egale. De aceea se schimbă în aceeași tranzacție
-- cu restul profilului, iar triggerele existente anulează linkurile de
-- recuperare și resetările adminului emise pe adresa veche.

CREATE OR REPLACE FUNCTION public.update_user_profile_guarded(p_target_id uuid, p_actor_id uuid, p_changes jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
DECLARE
  v_actor public.profiles%ROWTYPE; v_target public.profiles%ROWTYPE;
  v_full_name text; v_role text; v_telefon text; v_cif text; v_consultant_level text;
  v_email text; v_nume_firma text; v_adresa_firma text; v_departament text; v_specializare text;
  v_text_key text;
  v_before jsonb; v_after jsonb; v_old_values jsonb; v_new_values jsonb; v_profile jsonb;
BEGIN
  IF p_target_id IS NULL OR p_actor_id IS NULL OR p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object'
    OR p_changes = '{}'::jsonb
    OR p_changes - ARRAY['full_name','role','telefon','cif','consultant_level',
                         'email','nume_firma','adresa_firma','departament','specializare']::text[] <> '{}'::jsonb THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_PROFILE_PATCH';
  END IF;
  PERFORM pg_advisory_xact_lock(105, 1);
  PERFORM p.id FROM public.profiles p WHERE p.id IN (p_actor_id, p_target_id) ORDER BY p.id FOR UPDATE;
  SELECT * INTO v_actor FROM public.profiles WHERE id = p_actor_id;
  IF NOT FOUND OR v_actor.is_active IS NOT TRUE OR v_actor.role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACTIVE_ADMIN_REQUIRED';
  END IF;
  SELECT * INTO v_target FROM public.profiles WHERE id = p_target_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'USER_NOT_FOUND'; END IF;
  IF v_target.creation_pending THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACCOUNT_CREATION_PENDING'; END IF;

  FOREACH v_text_key IN ARRAY ARRAY['full_name','telefon','cif','email','nume_firma','adresa_firma','departament','specializare'] LOOP
    IF p_changes ? v_text_key AND jsonb_typeof(p_changes->v_text_key) NOT IN ('string','null') THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_PROFILE_PATCH';
    END IF;
  END LOOP;

  v_full_name := CASE WHEN p_changes ? 'full_name' THEN btrim(p_changes->>'full_name') ELSE v_target.full_name END;
  v_role := CASE WHEN p_changes ? 'role' THEN p_changes->>'role' ELSE v_target.role END;
  v_telefon := CASE WHEN p_changes ? 'telefon' THEN nullif(btrim(p_changes->>'telefon'), '') ELSE v_target.telefon END;
  v_cif := CASE WHEN p_changes ? 'cif' THEN p_changes->>'cif' ELSE v_target.cif END;
  v_consultant_level := CASE WHEN p_changes ? 'consultant_level' THEN p_changes->>'consultant_level' ELSE v_target.consultant_level END;
  v_email := CASE WHEN p_changes ? 'email' THEN lower(btrim(p_changes->>'email')) ELSE v_target.email END;
  v_nume_firma := CASE WHEN p_changes ? 'nume_firma' THEN nullif(btrim(p_changes->>'nume_firma'), '') ELSE v_target.nume_firma END;
  v_adresa_firma := CASE WHEN p_changes ? 'adresa_firma' THEN nullif(btrim(p_changes->>'adresa_firma'), '') ELSE v_target.adresa_firma END;
  v_departament := CASE WHEN p_changes ? 'departament' THEN nullif(btrim(p_changes->>'departament'), '') ELSE v_target.departament END;
  v_specializare := CASE WHEN p_changes ? 'specializare' THEN nullif(btrim(p_changes->>'specializare'), '') ELSE v_target.specializare END;

  IF (p_changes ? 'full_name' AND nullif(v_full_name, '') IS NULL)
    OR (p_changes ? 'role' AND (jsonb_typeof(p_changes->'role') <> 'string' OR v_role NOT IN ('admin','client','consultant')))
    OR (p_changes ? 'consultant_level' AND (jsonb_typeof(p_changes->'consultant_level') <> 'string' OR v_consultant_level NOT IN ('junior','senior'))) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_PROFILE_PATCH';
  END IF;
  -- Firma ține de client, specializarea de consultant, departamentul de echipă.
  IF ((p_changes ? 'nume_firma' OR p_changes ? 'adresa_firma') AND v_role <> 'client')
    OR (p_changes ? 'specializare' AND v_role <> 'consultant')
    OR (p_changes ? 'departament' AND v_role NOT IN ('consultant','admin')) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_PROFILE_PATCH';
  END IF;
  -- Aceleași câmpuri obligatorii ca la crearea contului (#111).
  IF (p_changes ? 'nume_firma' AND v_nume_firma IS NULL)
    OR (p_changes ? 'adresa_firma' AND v_adresa_firma IS NULL)
    OR (p_changes ? 'specializare' AND v_specializare IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PROFILE_FIELD_REQUIRED';
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

  IF p_changes ? 'email' AND v_email IS DISTINCT FROM lower(btrim(v_target.email)) THEN
    IF v_email IS NULL OR length(v_email) > 254 OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'EMAIL_INVALID';
    END IF;
    PERFORM 1 FROM auth.users u WHERE u.id = p_target_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'USER_NOT_FOUND'; END IF;
    IF EXISTS (SELECT 1 FROM auth.users u WHERE lower(btrim(u.email)) = v_email AND u.id <> p_target_id)
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE lower(btrim(p.email)) = v_email AND p.id <> p_target_id) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'EMAIL_TAKEN';
    END IF;
    UPDATE auth.users
    SET email = v_email, updated_at = clock_timestamp(),
        email_change = '', email_change_token_new = '', email_change_token_current = '',
        email_change_sent_at = NULL, email_change_confirm_status = 0
    WHERE id = p_target_id;
    UPDATE auth.identities
    SET identity_data = identity_data || jsonb_build_object('email', v_email), updated_at = clock_timestamp()
    WHERE user_id = p_target_id AND provider = 'email';
  ELSE
    v_email := v_target.email;
  END IF;

  v_before := jsonb_build_object('full_name',v_target.full_name,'role',v_target.role,'telefon',v_target.telefon,'cif',v_target.cif,
    'consultant_level',v_target.consultant_level,'email',v_target.email,'nume_firma',v_target.nume_firma,
    'adresa_firma',v_target.adresa_firma,'departament',v_target.departament,'specializare',v_target.specializare);
  v_after := jsonb_build_object('full_name',v_full_name,'role',v_role,'telefon',v_telefon,'cif',v_cif,
    'consultant_level',v_consultant_level,'email',v_email,'nume_firma',v_nume_firma,
    'adresa_firma',v_adresa_firma,'departament',v_departament,'specializare',v_specializare);
  SELECT coalesce(jsonb_object_agg(e.key,e.value),'{}'::jsonb), coalesce(jsonb_object_agg(e.key,v_after->e.key),'{}'::jsonb)
    INTO v_old_values,v_new_values FROM jsonb_each(v_before) e WHERE e.value IS DISTINCT FROM v_after->e.key;
  IF v_before IS DISTINCT FROM v_after THEN
    UPDATE public.profiles
    SET full_name=v_full_name, role=v_role, telefon=v_telefon, cif=v_cif, consultant_level=v_consultant_level,
        email=v_email, nume_firma=v_nume_firma, adresa_firma=v_adresa_firma, departament=v_departament,
        specializare=v_specializare, updated_at=clock_timestamp()
    WHERE id=p_target_id;
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
