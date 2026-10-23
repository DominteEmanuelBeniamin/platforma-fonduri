-- Issue #112: căutarea de pe server (jurnalul de audit, utilizatorii din chatul
-- privat) cu aceleași reguli ca motorul din interfață, `lib/search.ts`:
-- fără diacritice și majuscule, cuvintele în orice ordine, fiecare găsit întreg,
-- ca început de cuvânt, în interior (de la 3 litere) sau cu o greșeală de
-- tastare (de la 5 litere). Nivelul întors ordonează rezultatele la fel:
-- 0 exact, 1 început, 2 interior, 3 greșeală; NULL = nu se potrivește.
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

-- `unaccent` nu e IMMUTABLE fiindcă dicționarul se caută după search_path;
-- cu dicționarul numit explicit, rezultatul depinde doar de text.
CREATE OR REPLACE FUNCTION public.search_fold(value text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = ''
AS $fn$
  SELECT lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(value, '')))
$fn$;

-- Distanța de editare cu transpoziții, doar întrebarea „cel mult 1?".
CREATE OR REPLACE FUNCTION public.search_within_one_edit(a text, b text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = ''
AS $fn$
DECLARE
  la int := length(a);
  lb int := length(b);
  i int := 1;
BEGIN
  IF a = b THEN RETURN true; END IF;
  IF abs(la - lb) > 1 THEN RETURN false; END IF;
  WHILE i <= least(la, lb) AND substr(a, i, 1) = substr(b, i, 1) LOOP
    i := i + 1;
  END LOOP;
  IF la = lb THEN
    -- Substituție, sau două litere vecine inversate.
    RETURN substr(a, i + 1) = substr(b, i + 1)
      OR (substr(a, i, 1) = substr(b, i + 1, 1) AND substr(a, i + 1, 1) = substr(b, i, 1)
          AND substr(a, i + 2) = substr(b, i + 2));
  END IF;
  -- O literă în plus într-unul din ele.
  IF la < lb THEN RETURN substr(a, i) = substr(b, i + 1); END IF;
  RETURN substr(a, i + 1) = substr(b, i);
END
$fn$;

CREATE OR REPLACE FUNCTION public.search_word_tier(token text, word text)
RETURNS int LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = ''
AS $fn$
DECLARE
  n int := length(token);
  len int;
BEGIN
  IF word = token THEN RETURN 0; END IF;
  IF left(word, n) = token THEN RETURN 1; END IF;
  IF n >= 3 AND strpos(word, token) > 1 THEN RETURN 2; END IF;
  IF n >= 5 THEN
    -- Cuvântul întreg, sau începutul lui cât s-a tastat până acum.
    FOREACH len IN ARRAY ARRAY[length(word), n, n + 1, n - 1] LOOP
      IF len >= 4 AND len <= length(word) AND public.search_within_one_edit(token, left(word, len)) THEN
        RETURN 3;
      END IF;
    END LOOP;
  END IF;
  RETURN NULL;
END
$fn$;

CREATE OR REPLACE FUNCTION public.search_tier(haystack text, query text)
RETURNS int LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = ''
AS $fn$
DECLARE
  tokens text[];
  words text[];
  token text;
  word text;
  best int;
  tier int;
  worst int := 0;
BEGIN
  SELECT coalesce(array_agg(DISTINCT t), '{}') INTO tokens
  FROM regexp_split_to_table(public.search_fold(query), '[^[:alnum:]]+') AS t
  WHERE t <> '';
  IF cardinality(tokens) = 0 THEN RETURN 0; END IF;

  SELECT coalesce(array_agg(w), '{}') INTO words
  FROM regexp_split_to_table(public.search_fold(haystack), '[^[:alnum:]]+') AS w
  WHERE w <> '';

  FOREACH token IN ARRAY tokens LOOP
    best := NULL;
    FOREACH word IN ARRAY words LOOP
      tier := public.search_word_tier(token, word);
      IF tier IS NOT NULL AND (best IS NULL OR tier < best) THEN best := tier; END IF;
      EXIT WHEN best = 0;
    END LOOP;
    IF best IS NULL THEN RETURN NULL; END IF;
    worst := greatest(worst, best);
  END LOOP;
  RETURN worst;
END
$fn$;

-- Jurnalul de audit: descrierea, entitatea, autorul și utilizatorul afectat.
-- Întoarce doar id-urile paginii, în ordine, și totalul; rândurile le citește
-- ruta, ca până acum.
CREATE OR REPLACE FUNCTION public.search_audit_log_ids(
  p_query text,
  p_action_type text DEFAULT NULL,
  p_entity_type text DEFAULT NULL,
  p_entity_id uuid DEFAULT NULL,
  p_user_id uuid DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
)
RETURNS TABLE (id uuid, total bigint)
LANGUAGE sql STABLE
SET search_path = ''
AS $fn$
  WITH matched AS (
    SELECT l.id, l.created_at,
      public.search_tier(
        concat_ws(' ', l.description, l.entity_name, actor.full_name, actor.email, target.full_name, target.email),
        p_query
      ) AS tier
    FROM public.audit_logs l
    LEFT JOIN public.profiles actor ON actor.id = l.user_id
    LEFT JOIN public.profiles target ON l.entity_type = 'user' AND target.id = l.entity_id
    WHERE (p_action_type IS NULL OR l.action_type = p_action_type)
      AND (p_entity_type IS NULL OR l.entity_type = p_entity_type)
      AND (p_entity_id IS NULL OR l.entity_id = p_entity_id)
      AND (p_user_id IS NULL OR l.user_id = p_user_id)
      AND (p_from IS NULL OR l.created_at >= p_from)
      AND (p_to IS NULL OR l.created_at < p_to)
  )
  SELECT m.id, count(*) OVER () AS total
  FROM matched m
  WHERE m.tier IS NOT NULL
  ORDER BY m.tier, m.created_at DESC, m.id
  LIMIT greatest(p_limit, 0) OFFSET greatest(p_offset, 0)
$fn$;

-- Utilizatorii din chatul privat: nume, email, rol și specializare. Cine are
-- voie să scrie cui decide în continuare ruta (`canChatWithUser`).
CREATE OR REPLACE FUNCTION public.search_chat_profiles(p_query text, p_exclude uuid, p_limit int DEFAULT 20)
RETURNS TABLE (id uuid, full_name text, email text, role text, specializare text, is_active boolean)
LANGUAGE sql STABLE
SET search_path = ''
AS $fn$
  SELECT p.id, p.full_name, p.email, p.role::text, p.specializare, p.is_active
  FROM public.profiles p
  CROSS JOIN LATERAL (
    SELECT public.search_tier(
      concat_ws(' ', p.full_name, p.email,
        CASE p.role::text WHEN 'admin' THEN 'Administrator' WHEN 'consultant' THEN 'Consultant' WHEN 'client' THEN 'Client' END,
        p.specializare),
      p_query
    ) AS tier
  ) s
  WHERE p.id <> p_exclude
    AND p.is_active IS DISTINCT FROM false
    AND s.tier IS NOT NULL
  ORDER BY s.tier, p.full_name NULLS LAST, p.email
  LIMIT greatest(p_limit, 0)
$fn$;

-- Doar serverul (cheia de serviciu) le cheamă: rutele verifică rolul înainte.
REVOKE ALL ON FUNCTION public.search_audit_log_ids(text, text, text, uuid, uuid, timestamptz, timestamptz, int, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.search_chat_profiles(text, uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_audit_log_ids(text, text, text, uuid, uuid, timestamptz, timestamptz, int, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.search_chat_profiles(text, uuid, int) TO service_role;
