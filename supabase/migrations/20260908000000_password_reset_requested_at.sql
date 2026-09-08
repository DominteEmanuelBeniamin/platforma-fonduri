alter table public.profiles
  add column if not exists password_reset_requested_at timestamptz null;

comment on column public.profiles.password_reset_requested_at is
  'Ultima solicitare publică de resetare a parolei; folosită pentru cooldown-ul de 15 minute.';
