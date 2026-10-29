-- Copia zilnică a bazei, cât proiectul e pe planul Free, care nu are backupuri.
-- Jobul `/api/cron/copie-baza` scrie un export NDJSON comprimat în bucketul
-- privat `backups` și păstrează ultimele zile (`lib/db-backup.ts`).
--
-- Nu e un backup adevărat: stă în același proiect Supabase. Acoperă greșelile
-- (o ștergere, o migrare stricată), nu pierderea proiectului. Pentru asta e
-- nevoie de Supabase Pro și de o copie în afara Supabase.

-- Fără politici pe `storage.objects`: bucketul îl vede doar cheia service_role.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('backups', 'backups', false, 52428800, array['application/gzip'])
on conflict (id) do nothing;

-- Tabelele de copiat, cu cheia primară după care se citesc pe pagini.
-- Lista vine din catalog, ca un tabel nou să intre singur în copie.
create or replace function public.backup_table_catalog()
returns table (table_name text, key_columns text[])
language sql
stable
security invoker
set search_path = ''
as $function$
  select relation.relname::text,
         coalesce(
           (
             select array_agg(attribute.attname::text order by keys.ord)
             from pg_catalog.pg_index as idx
             cross join lateral unnest(idx.indkey::smallint[]) with ordinality as keys(attnum, ord)
             join pg_catalog.pg_attribute as attribute
               on attribute.attrelid = idx.indrelid and attribute.attnum = keys.attnum
             where idx.indrelid = relation.oid and idx.indisprimary
           ),
           array[]::text[]
         )
  from pg_catalog.pg_class as relation
  join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public' and relation.relkind in ('r', 'p')
  order by relation.relname;
$function$;

revoke all on function public.backup_table_catalog() from public, anon, authenticated;
grant execute on function public.backup_table_catalog() to service_role;
