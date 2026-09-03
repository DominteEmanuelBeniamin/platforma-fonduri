-- Test de integrare PostgreSQL pentru migrarea de ordine.
-- Se rulează cu psql pe o bază efemeră: psql --set ON_ERROR_STOP=1 -f ...
-- Tranzacția lasă baza neschimbată după execuție.

\set ON_ERROR_STOP on
begin;

-- Baza efemeră de test trebuie să aibă rolurile browser/service. Crearea este
-- condiționată, iar tranzacția o anulează la final dacă rolul nu exista.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end;
$$;

create table public.project_phases (
  id uuid primary key,
  project_id uuid not null,
  order_index integer
);

create table public.project_activities (
  id uuid primary key,
  phase_id uuid not null,
  order_index integer
);

\ir ../migrations/20260903000000_project_duplication_order_rpc.sql

insert into public.project_phases (id, project_id, order_index) values
  ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 1),
  ('00000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 2),
  ('00000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 3),
  ('00000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 2),
  ('00000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000002', 2);

select public.shift_project_phases_after_duplicate(
  '10000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000004'
);

do $$
begin
  if exists (
    select 1
    from public.project_phases
    where id in (
      '00000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000003'
    )
    and order_index <> case id
      when '00000000-0000-0000-0000-000000000002'::uuid then 3
      else 4
    end
  ) then raise exception 'deplasarea fazelor a produs o ordine greșită'; end if;
  if (select order_index from public.project_phases where id = '00000000-0000-0000-0000-000000000004') <> 2
     or (select order_index from public.project_phases where id = '00000000-0000-0000-0000-000000000005') <> 2 then
    raise exception 'copia sau proiectul străin a fost modificat';
  end if;
end;
$$;

insert into public.project_activities (id, phase_id, order_index) values
  ('00000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000001', 1),
  ('00000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000001', 2),
  ('00000000-0000-0000-0000-000000000013', '20000000-0000-0000-0000-000000000001', 3),
  ('00000000-0000-0000-0000-000000000014', '20000000-0000-0000-0000-000000000001', 2),
  ('00000000-0000-0000-0000-000000000015', '20000000-0000-0000-0000-000000000002', 2);

select public.shift_project_activities_after_duplicate(
  '20000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000014'
);

do $$
begin
  if (select order_index from public.project_activities where id = '00000000-0000-0000-0000-000000000012') <> 3
     or (select order_index from public.project_activities where id = '00000000-0000-0000-0000-000000000013') <> 4
     or (select order_index from public.project_activities where id = '00000000-0000-0000-0000-000000000014') <> 2
     or (select order_index from public.project_activities where id = '00000000-0000-0000-0000-000000000015') <> 2 then
    raise exception 'deplasarea activităților nu este izolată';
  end if;
end;
$$;

do $$
declare
  rejected boolean := false;
begin
  begin
    perform public.shift_project_phases_after_duplicate(
      '10000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000004'
    );
  exception when others then
    rejected := true;
  end;
  if not rejected then raise exception 'RPC-ul a acceptat o sursă din alt proiect'; end if;
  rejected := false;
  begin
    perform public.shift_project_activities_after_duplicate(
      '20000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000011',
      '00000000-0000-0000-0000-000000000014'
    );
  exception when others then
    rejected := true;
  end;
  if not rejected then raise exception 'RPC-ul a acceptat o activitate din altă fază'; end if;
  rejected := false;
  begin
    perform public.shift_project_phases_after_duplicate(
      '10000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000005'
    );
  exception when others then
    rejected := true;
  end;
  if not rejected then raise exception 'RPC-ul a acceptat copia din alt proiect'; end if;
  rejected := false;
  begin
    perform public.shift_project_activities_after_duplicate(
      '20000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000011',
      '00000000-0000-0000-0000-000000000015'
    );
  exception when others then
    rejected := true;
  end;
  if not rejected then raise exception 'RPC-ul a acceptat copia din altă fază'; end if;
end;
$$;

insert into public.project_phases (id, project_id, order_index) values
  ('00000000-0000-0000-0000-000000000041', '10000000-0000-0000-0000-000000000004', null),
  ('00000000-0000-0000-0000-000000000042', '10000000-0000-0000-0000-000000000004', 1),
  ('00000000-0000-0000-0000-000000000043', '10000000-0000-0000-0000-000000000004', 2);

select public.shift_project_phases_after_duplicate(
  '10000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000041',
  '00000000-0000-0000-0000-000000000042'
);

do $$
begin
  if (select order_index from public.project_phases where id = '00000000-0000-0000-0000-000000000042') <> 1
     or (select order_index from public.project_phases where id = '00000000-0000-0000-0000-000000000043') <> 3 then
    raise exception 'coalesce-ul order_index nul a produs o ordine greșită';
  end if;
end;
$$;

create function public.pr93_raise_on_order_update()
returns trigger
language plpgsql
as $$
begin
  if new.id in (
    '00000000-0000-0000-0000-000000000023'::uuid,
    '00000000-0000-0000-0000-000000000033'::uuid
  ) then
    raise exception 'eroare UPDATE injectată pentru test';
  end if;
  return new;
end;
$$;

insert into public.project_phases (id, project_id, order_index) values
  ('00000000-0000-0000-0000-000000000021', '10000000-0000-0000-0000-000000000003', 1),
  ('00000000-0000-0000-0000-000000000022', '10000000-0000-0000-0000-000000000003', 2),
  ('00000000-0000-0000-0000-000000000023', '10000000-0000-0000-0000-000000000003', 3),
  ('00000000-0000-0000-0000-000000000024', '10000000-0000-0000-0000-000000000003', 4),
  ('00000000-0000-0000-0000-000000000025', '10000000-0000-0000-0000-000000000003', 2);

create trigger pr93_fail_phase_shift
before update of order_index on public.project_phases
for each row execute function public.pr93_raise_on_order_update();

do $$
begin
  begin
    perform public.shift_project_phases_after_duplicate(
      '10000000-0000-0000-0000-000000000003',
      '00000000-0000-0000-0000-000000000021',
      '00000000-0000-0000-0000-000000000025'
    );
    raise exception 'RPC-ul trebuia să eșueze prin trigger';
  exception when others then
    if position('UPDATE injectată' in sqlerrm) = 0 then raise; end if;
  end;
  delete from public.project_phases where id = '00000000-0000-0000-0000-000000000025';
  if exists (
    select 1 from public.project_phases
    where project_id = '10000000-0000-0000-0000-000000000003'
      and order_index <> case id
        when '00000000-0000-0000-0000-000000000021'::uuid then 1
        when '00000000-0000-0000-0000-000000000022'::uuid then 2
        when '00000000-0000-0000-0000-000000000023'::uuid then 3
        else 4
      end
  ) then raise exception 'UPDATE-ul parțial nu a fost anulat'; end if;
end;
$$;

drop trigger pr93_fail_phase_shift on public.project_phases;

insert into public.project_activities (id, phase_id, order_index) values
  ('00000000-0000-0000-0000-000000000031', '30000000-0000-0000-0000-000000000001', 1),
  ('00000000-0000-0000-0000-000000000032', '30000000-0000-0000-0000-000000000001', 2),
  ('00000000-0000-0000-0000-000000000033', '30000000-0000-0000-0000-000000000001', 3),
  ('00000000-0000-0000-0000-000000000034', '30000000-0000-0000-0000-000000000001', 4),
  ('00000000-0000-0000-0000-000000000035', '30000000-0000-0000-0000-000000000001', 2);

create trigger pr93_fail_activity_shift
before update of order_index on public.project_activities
for each row execute function public.pr93_raise_on_order_update();

do $$
begin
  begin
    perform public.shift_project_activities_after_duplicate(
      '30000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000031',
      '00000000-0000-0000-0000-000000000035'
    );
    raise exception 'RPC-ul trebuia să eșueze prin trigger';
  exception when others then
    if position('UPDATE injectată' in sqlerrm) = 0 then raise; end if;
  end;
  delete from public.project_activities where id = '00000000-0000-0000-0000-000000000035';
  if exists (
    select 1 from public.project_activities
    where phase_id = '30000000-0000-0000-0000-000000000001'
      and order_index <> case id
        when '00000000-0000-0000-0000-000000000031'::uuid then 1
        when '00000000-0000-0000-0000-000000000032'::uuid then 2
        when '00000000-0000-0000-0000-000000000033'::uuid then 3
        else 4
      end
  ) then raise exception 'UPDATE-ul parțial al activităților nu a fost anulat'; end if;
end;
$$;

drop trigger pr93_fail_activity_shift on public.project_activities;
drop function public.pr93_raise_on_order_update();

do $$
begin
  if (select count(*) from pg_roles where rolname in ('anon', 'authenticated', 'service_role')) <> 3 then
    raise exception 'baza de test trebuie să aibă rolurile anon/authenticated/service_role';
  end if;
  if has_function_privilege('anon', 'public.shift_project_phases_after_duplicate(uuid,uuid,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.shift_project_phases_after_duplicate(uuid,uuid,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.shift_project_activities_after_duplicate(uuid,uuid,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.shift_project_activities_after_duplicate(uuid,uuid,uuid)', 'EXECUTE') then
    raise exception 'unul dintre rolurile browser are EXECUTE pe RPC';
  end if;
  if not has_function_privilege('service_role', 'public.shift_project_phases_after_duplicate(uuid,uuid,uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.shift_project_activities_after_duplicate(uuid,uuid,uuid)', 'EXECUTE') then
    raise exception 'service_role nu are EXECUTE pe RPC';
  end if;
end;
$$;

-- Verifică efectiv EXECUTE sub rolurile browserului și service_role.
-- Rularea necesită un utilizator de test care poate face SET ROLE la aceste roluri.
do $$
begin
  execute 'set local role anon';
  begin
    perform public.shift_project_phases_after_duplicate(
      '10000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000004'
    );
    raise exception 'anon a executat RPC-ul';
  exception when insufficient_privilege then null;
  end;
  execute 'set local role authenticated';
  begin
    perform public.shift_project_activities_after_duplicate(
      '20000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000011',
      '00000000-0000-0000-0000-000000000014'
    );
    raise exception 'authenticated a executat RPC-ul';
  exception when insufficient_privilege then null;
  end;
  execute 'set local role service_role';
  perform public.shift_project_phases_after_duplicate(
    '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000004'
  );
  execute 'reset role';
end;
$$;

rollback;
