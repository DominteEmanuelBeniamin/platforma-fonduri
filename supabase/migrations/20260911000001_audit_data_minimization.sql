-- Keep audit payloads useful for event history without retaining message bodies
-- or profile/contact data. This is shared by the INSERT trigger and the
-- one-time cleanup below, including rows written by SQL RPCs.
DO $$
BEGIN
  IF to_regclass('public.audit_logs') IS NULL THEN
    RAISE EXCEPTION
      'Audit data minimization requires existing table public.audit_logs';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.minimize_audit_jsonb(value jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  result jsonb;
  item record;
  normalized text;
  compact text;
BEGIN
  IF value IS NULL THEN
    RETURN NULL;
  END IF;

  IF jsonb_typeof(value) = 'array' THEN
    SELECT coalesce(jsonb_agg(public.minimize_audit_jsonb(elements.value)), '[]'::jsonb)
      INTO result
      FROM jsonb_array_elements(value) AS elements(value);
    RETURN result;
  END IF;

  IF jsonb_typeof(value) <> 'object' THEN
    RETURN value;
  END IF;

  result := '{}'::jsonb;
  FOR item IN SELECT entries.key, entries.value FROM jsonb_each(value) AS entries(key, value) LOOP
    normalized := lower(replace(replace(
      regexp_replace(item.key, '([a-z0-9])([A-Z])', '\1_\2', 'g'),
      '-', '_'
    ), ' ', '_'));
    compact := replace(normalized, '_', '');

    -- Message content and file-name lists are never audit payload fields.
    IF normalized ~ '(^|_)(body|preview|content)(_|$)'
      OR normalized IN ('message', 'message_body', 'message_preview')
      OR normalized ~ '(^|_)(file|image|attachment)(_?)(name|names|name_list)$'
      OR normalized IN ('files', 'file_list', 'file_names', 'image_names')
      OR normalized IN (
        'original_name', 'attachment_original_name', 'storage_path',
        'attachment_path', 'file_path', 'image_path', 'relative_path',
        'zip_name', 'archive_name'
      )
      OR normalized IN ('description', 'comment', 'comments', 'note', 'notes', 'observations', 'observatii')
      OR normalized LIKE '%_reason'
      OR compact IN (
        'signedurl', 'accesstoken', 'refreshtoken', 'bodypreview',
        'messagepreview', 'filenames', 'imagenames', 'clientemail',
        'fullname', 'bankaccount', 'contactemail', 'contactphone',
        'personcontact', 'persoanacontact', 'nume', 'numecomplet',
        'numeprenume', 'numepersoana', 'numecontact', 'numefirma'
      )
      -- Contact, identity, financial, and authentication data are omitted.
      OR normalized ~ '(^|_)(email|e_mail|phone|telephone|telefon|mobile|fax|address|adresa|postal|zip|postcode|cnp|ssn|tax_id|iban|bank|account|routing|swift|cif|cui)(_|$)'
      OR normalized IN ('company', 'company_name', 'company_contact', 'firm_name', 'nume_firma', 'contact', 'contact_name', 'contact_person', 'contact_email', 'contact_phone', 'persoana_contact')
      OR normalized ~ '(^|_)(password|token|secret|signed_url|signature|api_key|apikey|authorization|cookie|credential|private_key|encryption_key|signing_key)(_|$)' THEN
      CONTINUE;
    END IF;

    result := result || jsonb_build_object(
      item.key,
      public.minimize_audit_jsonb(item.value)
    );
  END LOOP;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.minimize_audit_text(value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  IF value IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN regexp_replace(
    value,
    '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}',
    '[email redacted]',
    'gi'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.sanitize_audit_log_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.old_values := public.minimize_audit_jsonb(NEW.old_values);
  NEW.new_values := public.minimize_audit_jsonb(NEW.new_values);

  IF NEW.entity_type IN ('chat_message', 'private_message', 'message')
    AND NEW.entity_id IS NOT NULL THEN
    NEW.entity_name := 'message:' || NEW.entity_id::text;
  ELSIF NEW.entity_type = 'file_access' AND NEW.entity_id IS NOT NULL THEN
    NEW.entity_name := 'file:' || NEW.entity_id::text;
  ELSE
    NEW.entity_name := public.minimize_audit_text(NEW.entity_name);
  END IF;
  IF NEW.entity_type = 'file_access' THEN
    NEW.description := 'Acces fișier înregistrat';
  ELSE
    NEW.description := public.minimize_audit_text(NEW.description);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_logs_minimize_before_insert ON public.audit_logs;
CREATE TRIGGER audit_logs_minimize_before_insert
BEFORE INSERT ON public.audit_logs
FOR EACH ROW
EXECUTE FUNCTION public.sanitize_audit_log_insert();

REVOKE EXECUTE ON FUNCTION public.minimize_audit_jsonb(jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.minimize_audit_text(text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sanitize_audit_log_insert()
  FROM PUBLIC, anon, authenticated;

-- Clean existing rows once. The append-only trigger is the only trigger
-- disabled for this controlled migration; it is restored even on failure.
DO $$
DECLARE
  has_append_only boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.audit_logs'::regclass
      AND tgname = 'audit_logs_append_only'
      AND NOT tgisinternal
  ) INTO has_append_only;

  BEGIN
    IF has_append_only THEN
      ALTER TABLE public.audit_logs DISABLE TRIGGER audit_logs_append_only;
    END IF;

    UPDATE public.audit_logs
    SET old_values = public.minimize_audit_jsonb(old_values),
        new_values = public.minimize_audit_jsonb(new_values),
        entity_name = CASE
          WHEN entity_type IN ('chat_message', 'private_message', 'message')
            AND entity_id IS NOT NULL
            THEN 'message:' || entity_id::text
          WHEN entity_type = 'file_access' AND entity_id IS NOT NULL
            THEN 'file:' || entity_id::text
          ELSE public.minimize_audit_text(entity_name)
        END,
        description = CASE
          WHEN entity_type = 'file_access' THEN 'Acces fișier înregistrat'
          ELSE public.minimize_audit_text(description)
        END;

    IF has_append_only THEN
      ALTER TABLE public.audit_logs ENABLE TRIGGER audit_logs_append_only;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    IF has_append_only THEN
      BEGIN
        ALTER TABLE public.audit_logs ENABLE TRIGGER audit_logs_append_only;
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END IF;
    RAISE;
  END;
END;
$$;
