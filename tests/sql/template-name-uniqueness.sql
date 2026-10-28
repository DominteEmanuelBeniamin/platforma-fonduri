-- Run after the migration on an isolated database: psql -v ON_ERROR_STOP=1 -f tests/sql/template-name-uniqueness.sql
begin;
do $$
declare
  base text := '__name_test_' || gen_random_uuid()::text;
  first_id uuid;
  second_id uuid;
  rejected boolean;
begin
  if template_names.normalize(U&'\1C89\A7CB\A7CC\A7DA\A7DC\+010D50\+010D51\+010D52\+010D53\+010D54\+010D55\+010D56\+010D57\+010D58\+010D59\+010D5A\+010D5B\+010D5C\+010D5D\+010D5E\+010D5F\+010D60\+010D61\+010D62\+010D63\+010D64\+010D65') <> U&'\1C8A\0264\A7CD\A7DB\019B\+010D70\+010D71\+010D72\+010D73\+010D74\+010D75\+010D76\+010D77\+010D78\+010D79\+010D7A\+010D7B\+010D7C\+010D7D\+010D7E\+010D7F\+010D80\+010D81\+010D82\+010D83\+010D84\+010D85' then
    raise exception 'Unicode 16 case mappings differ';
  end if;
  if template_names.normalize(U&'\039F\03A3') <> U&'\03BF\03C2' then
    raise exception 'contextual case mapping differs';
  end if;
  if template_names.normalize(U&'  \0102\00A0 \00CE  ') <> U&'\0103 \00EE' then
    raise exception 'Romanian case or whitespace normalization differs';
  end if;
  insert into public.project_templates (name, slug) values (' ', base || '-empty') returning id into first_id;
  delete from public.project_templates where id = first_id;
  if found is false then raise exception 'blank name was not deleted'; end if;
  insert into public.project_templates (name, slug) values (base || '  Test', base || '-1') returning id into first_id;
  rejected := false;
  begin
    insert into public.project_templates (name, slug) values (upper(base) || E'\t test ', base || '-2');
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'template_name_taken' then raise; end if;
    rejected := true;
  end;
  if not rejected then raise exception 'normalized duplicate was accepted'; end if;

  -- Simulate rows that predate the migration and its seeded owner count.
  execute 'alter table public.project_templates disable trigger reserve_template_name';
  insert into public.project_templates (name, slug) values (base || ' test', base || '-2') returning id into second_id;
  execute 'alter table public.project_templates enable trigger reserve_template_name';
  update template_names.reservations set owners = owners + 1 where name = template_names.normalize(base || ' test');
  update public.project_templates set name = upper(base) || ' TEST ' where id = first_id;
  delete from public.project_templates where id = first_id;
  rejected := false;
  begin
    insert into public.project_templates (name, slug) values (base || ' test', base || '-3');
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'template_name_taken' then raise; end if;
    rejected := true;
  end;
  if not rejected then raise exception 'remaining historical duplicate lost its reservation'; end if;
  delete from public.project_templates where id = second_id;
  insert into public.project_templates (name, slug) values (base || ' test', base || '-3');
end $$;
rollback;
