-- Temporary local proof only. The runner installs this and drops the schema/triggers.
-- Not a migration; do not deploy this file as the implementation of #107.
create schema issue107_probe;
revoke all on schema issue107_probe from public, anon, authenticated;
grant usage on schema issue107_probe to service_role, supabase_auth_admin;
create table issue107_probe.flows (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token_hash text unique,
  generation uuid not null default gen_random_uuid(),
  expires_at timestamptz not null,
  state text not null check (state in ('issued','revoked','completed')),
  attempt uuid,
  audit_id uuid,
  fail_audit boolean not null default false
);
alter table issue107_probe.flows enable row level security;
revoke all on issue107_probe.flows from public, anon, authenticated;
create table issue107_probe.hook_events (user_id uuid, action text);
alter table issue107_probe.hook_events enable row level security;
revoke all on issue107_probe.hook_events from public, anon, authenticated;

create function issue107_probe.invalidate(p_user uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $fn$
begin
  -- ponytail: same global lock as #105; use shared per-account locks only if contention warrants it.
  perform pg_advisory_xact_lock(105,1);
  update issue107_probe.flows set state='revoked', token_hash=null, attempt=null where user_id=p_user;
  update public.profiles set password_reset_requested_at=null where id=p_user;
end $fn$;
create function issue107_probe.profile_changed() returns trigger
language plpgsql security definer set search_path=pg_catalog as $fn$
begin
  -- Only fixtures with a private flow are affected.
  if exists(select 1 from issue107_probe.flows where user_id=new.id)
     and (new.is_active is distinct from old.is_active
          or lower(btrim(new.email)) is distinct from lower(btrim(old.email))) then
    update issue107_probe.flows set state='revoked', token_hash=null, attempt=null where user_id=new.id;
    new.password_reset_requested_at:=null;
  end if;
  return new;
end $fn$;
create trigger issue107_probe_profile_changed before update of is_active,email on public.profiles
for each row execute function issue107_probe.profile_changed();

create function issue107_probe.reserve(p_user uuid,p_hash text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $fn$
declare v_profile public.profiles%rowtype; v_auth auth.users%rowtype; v_now timestamptz;
begin
  perform pg_advisory_xact_lock(105,1);
  select * into v_profile from public.profiles where id=p_user for update;
  select * into v_auth from auth.users where id=p_user for update;
  v_now:=clock_timestamp();
  if v_profile.id is null or v_auth.id is null or not v_profile.is_active
     or v_profile.auth_sync_pending or v_auth.banned_until>v_now
     or lower(btrim(v_profile.email)) is distinct from lower(btrim(v_auth.email)) then
    return '{"status":"ineligible"}'::jsonb;
  end if;
  if v_profile.password_reset_requested_at>v_now-interval '15 minutes' then
    return '{"status":"cooldown"}'::jsonb;
  end if;
  insert into issue107_probe.flows(user_id,token_hash,expires_at,state)
  values(p_user,p_hash,v_now+interval '1 hour','issued')
  on conflict(user_id) do update set token_hash=excluded.token_hash,expires_at=excluded.expires_at,
    state='issued',generation=gen_random_uuid(),attempt=null,audit_id=null;
  -- Accepted app issuance also invalidates older native email credentials.
  update auth.users set recovery_token='',recovery_sent_at=null,confirmation_token='',confirmation_sent_at=null where id=p_user;
  delete from auth.one_time_tokens where user_id=p_user and token_type::text in ('recovery_token','confirmation_token');
  update public.profiles set password_reset_requested_at=v_now where id=p_user;
  return '{"status":"issued"}'::jsonb;
end $fn$;

create function issue107_probe.finalize(p_hash text,p_password text,p_attempt uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $fn$
declare v_flow issue107_probe.flows%rowtype; v_profile public.profiles%rowtype;
        v_auth auth.users%rowtype; v_audit uuid;
begin
  perform pg_advisory_xact_lock(105,1);
  select * into v_flow from issue107_probe.flows where token_hash=p_hash;
  if v_flow.user_id is null or p_attempt is null then return '{"status":"invalid"}'::jsonb; end if;
  select * into v_profile from public.profiles where id=v_flow.user_id for update;
  select * into v_auth from auth.users where id=v_flow.user_id for update;
  select * into v_flow from issue107_probe.flows where token_hash=p_hash for update;
  if v_flow.state='completed' and v_flow.attempt=p_attempt then
    -- Idempotent receipt only; never return or issue a session on replay.
    return '{"status":"already_completed"}'::jsonb;
  end if;
  if v_flow.user_id is null or v_profile.id is null or v_auth.id is null
     or v_flow.state is distinct from 'issued' or v_profile.is_active is distinct from true or v_profile.auth_sync_pending
     or v_auth.banned_until>clock_timestamp() or v_flow.expires_at<=clock_timestamp()
     or lower(btrim(v_profile.email)) is distinct from lower(btrim(v_auth.email)) then
    return '{"status":"invalid"}'::jsonb;
  end if;
  -- Proof targets bcrypt, six-character minimum, no DB encryption, no additional password policy.
  if p_password is null or char_length(p_password)<6 or octet_length(p_password)>72 then
    return '{"status":"invalid_password"}'::jsonb;
  end if;
  if extensions.crypt(p_password,v_auth.encrypted_password)=v_auth.encrypted_password then
    return '{"status":"same_password"}'::jsonb;
  end if;
  update auth.users set encrypted_password=extensions.crypt(p_password,extensions.gen_salt('bf',10)),
    updated_at=clock_timestamp(),confirmation_token='',confirmation_sent_at=null,recovery_token='',recovery_sent_at=null,
    email_change_token_new='',email_change_token_current='',email_change_sent_at=null,
    phone_change_token='',phone_change_sent_at=null,reauthentication_token='',reauthentication_sent_at=null
    where id=v_flow.user_id;
  delete from auth.one_time_tokens where user_id=v_flow.user_id;
  delete from auth.sessions where user_id=v_flow.user_id;
  update public.profiles set must_change_password=false where id=v_flow.user_id;
  insert into public.audit_logs(user_id,action_type,entity_type,entity_id,entity_name,new_values,description)
    values(v_flow.user_id,'password_reset_completed','user',v_flow.user_id,v_profile.email,
      jsonb_build_object('source','self_recovery','attempt_id',p_attempt),'Issue 107 local atomic recovery proof')
    returning id into v_audit;
  update issue107_probe.flows set state='completed',attempt=p_attempt,audit_id=v_audit where user_id=v_flow.user_id;
  return '{"status":"completed"}'::jsonb;
end $fn$;

create function issue107_probe.reject_audit() returns trigger
language plpgsql security definer set search_path=pg_catalog as $fn$
begin
  if new.action_type='password_reset_completed'
     and exists(select 1 from issue107_probe.flows where user_id=new.user_id and fail_audit) then
    raise exception 'ISSUE107_FIXTURE_ONLY_AUDIT_FAULT';
  end if;
  return new;
end $fn$;
create trigger issue107_probe_reject_audit before insert on public.audit_logs
for each row execute function issue107_probe.reject_audit();

create function issue107_probe.email_hook(event jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $fn$
begin
  insert into issue107_probe.hook_events values((event->'user'->>'id')::uuid,event->'email_data'->>'email_action_type');
  -- Success deliberately sends no native recovery/magic link. No credential is stored.
  return '{}'::jsonb;
end $fn$;
revoke all on all functions in schema issue107_probe from public, anon, authenticated;
grant execute on function issue107_probe.reserve(uuid,text),issue107_probe.finalize(text,text,uuid),
  issue107_probe.invalidate(uuid) to service_role;
grant execute on function issue107_probe.email_hook(jsonb) to supabase_auth_admin;


-- Probe scopes this adapter to fixture accounts that have a private flow.
-- A production adapter must cover all application accounts, independent of flow retention.
create function issue107_probe.native_email_token_gate() returns trigger
language plpgsql security definer set search_path=pg_catalog as $fn$
begin
  -- session_user retains the actual DB connection identity across SECURITY DEFINER.
  if session_user<>'supabase_auth_admin' then return new; end if;
  if tg_table_name='users' then
    if exists(select 1 from issue107_probe.flows where user_id=new.id) then
      new.recovery_token:=''; new.recovery_sent_at:=null;
      new.confirmation_token:=''; new.confirmation_sent_at:=null;
    end if;
  elsif new.token_type::text in ('recovery_token','confirmation_token')
    and exists(select 1 from issue107_probe.flows where user_id=new.user_id) then
    return null;
  end if;
  return new;
end $fn$;
revoke all on function issue107_probe.native_email_token_gate() from public,anon,authenticated;
create trigger issue107_probe_native_user_tokens before update of recovery_token,confirmation_token on auth.users
for each row execute function issue107_probe.native_email_token_gate();
create trigger issue107_probe_native_one_time_tokens before insert or update on auth.one_time_tokens
for each row execute function issue107_probe.native_email_token_gate();
