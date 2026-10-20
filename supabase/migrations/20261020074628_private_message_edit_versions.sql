CREATE OR REPLACE FUNCTION public.set_private_message_edited_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
BEGIN
  NEW.edited_at := GREATEST(
    clock_timestamp(),
    COALESCE(OLD.edited_at, OLD.created_at) + interval '1 microsecond'
  );
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_private_message_edited_at() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER private_messages_set_edited_at
BEFORE UPDATE OF body ON public.private_messages
FOR EACH ROW
EXECUTE FUNCTION public.set_private_message_edited_at();
