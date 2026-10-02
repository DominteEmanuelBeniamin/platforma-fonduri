alter table public.profiles
  add column must_change_password boolean not null default false;

comment on column public.profiles.must_change_password is
  'Parola inițială generată pentru cont este temporară; marcajul se șterge la schimbarea parolei.';