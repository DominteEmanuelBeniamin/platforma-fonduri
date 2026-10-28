begin;
-- Existing duplicate names remain unchanged and editable; counts reserve each name until its last owner leaves.
lock table public.project_templates in share row exclusive mode;
create schema if not exists template_names authorization postgres;
revoke all on schema template_names from public;

create function template_names.normalize(value text) returns text
language sql immutable strict set search_path = pg_catalog as $$
  -- ICU versions in Node and Postgres differ on Unicode 16 case mappings.
  select lower(btrim(regexp_replace(translate(value, U&'\1C89\A7CB\A7CC\A7DA\A7DC\+010D50\+010D51\+010D52\+010D53\+010D54\+010D55\+010D56\+010D57\+010D58\+010D59\+010D5A\+010D5B\+010D5C\+010D5D\+010D5E\+010D5F\+010D60\+010D61\+010D62\+010D63\+010D64\+010D65', U&'\1C8A\0264\A7CD\A7DB\019B\+010D70\+010D71\+010D72\+010D73\+010D74\+010D75\+010D76\+010D77\+010D78\+010D79\+010D7A\+010D7B\+010D7C\+010D7D\+010D7E\+010D7F\+010D80\+010D81\+010D82\+010D83\+010D84\+010D85'), U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+', ' ', 'g')) collate "ro-x-icu")
$$;

create table template_names.reservations (
  name text primary key,
  owners integer not null check (owners >= 0)
);
insert into template_names.reservations (name, owners)
select normalized, count(*)::integer
from (select template_names.normalize(name) as normalized from public.project_templates) names
where normalized <> ''
group by normalized;

create function template_names.reserve() returns trigger
language plpgsql security definer set search_path = pg_catalog as $$
declare
  old_name text;
  new_name text;
  remaining integer;
begin
  if tg_op <> 'INSERT' then old_name := template_names.normalize(old.name); end if;
  if tg_op <> 'DELETE' then new_name := template_names.normalize(new.name); end if;
  if old_name is not distinct from new_name then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if new_name is not null and new_name <> '' then
    begin
      insert into template_names.reservations (name, owners) values (new_name, 1);
    exception when unique_violation then
      raise exception using errcode = 'P0001', message = 'template_name_taken', detail = new.name;
    end;
  end if;
  if old_name is not null and old_name <> '' then
    update template_names.reservations set owners = owners - 1 where name = old_name returning owners into remaining;
    if remaining = 0 then delete from template_names.reservations where name = old_name; end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function template_names.reserve() from public;

create trigger reserve_template_name before insert or update of name or delete on public.project_templates
for each row execute function template_names.reserve();

commit;
