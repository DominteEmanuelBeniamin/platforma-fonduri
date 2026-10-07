# Activarea account recovery (#107)

Migrațiile instalează mecanismul dezactivat. Activarea se face separat, numai după ce mediul țintă trece verificările de mai jos. Acest rollout este documentat pentru un mediu de preview izolat; nu face deploy și nu schimbă hosted settings.

## Ordinea de rollout

1. Aplică migrațiile în mediul ales și confirmă că setarea recovery rămâne `enabled=false`. Nu activa funcția în timpul aplicării schemei.
2. Configurează Auth înainte de activare: versiunea GoTrue exact `v2.197.0`, minimum password length `6`, fără cerințe suplimentare de parolă, DB encryption dezactivat, OTP expiry `3600`, signup dezactivat, hook-ul `pg-functions://postgres/account_recovery/send_email_hook` activ, toți providerii alternativi dezactivați și conexiunea DB reală GoTrue cu utilizatorul `supabase_auth_admin`. Simpla existență a rolului în schemă nu dovedește că Auth îl folosește. Dezactivează link tracking în setările expeditorului Resend.
3. Configurează variabilele server-only pentru mediul curent: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RECOVERY_SECRET`, `CRON_SECRET`, `RESEND_API_KEY` și `RESEND_FROM_EMAIL`. `SUPABASE_URL` trebuie să fie identic cu `NEXT_PUBLIC_SUPABASE_URL`. Păstrează `RECOVERY_SECRET` ca base64 canonic de exact 32 bytes. `NEXT_PUBLIC_APP_URL` este origine fără path, query sau fragment; preview și production folosesc HTTPS, iar development local poate folosi HTTP doar pe loopback. `REMINDER_EMAIL_OVERRIDE_TO` este obligatoriu în development și preview și interzis în production.
4. Configurează un dispatch durabil pentru `/api/auth/recovery/dispatch` la fiecare minut și păstrează cronul zilnic `/api/cron/deadline-reminders`. Cronul Vercel la fiecare minut cere plan Pro sau Enterprise ([documentația Vercel](https://vercel.com/docs/cron-jobs/usage-and-pricing)). Pe altă platformă, folosește scheduler-ul echivalent și `CRON_SECRET`.
5. Rulează preflight-ul explicit înainte de orice activare sau scriere hosted:

   ```powershell
   node scripts/issue-107-preflight.mjs --env-file <cale-catre-env-explicit> --auth-config <cale-catre-config-auth-nesecret>
   ```

   Pentru Supabase local, omite `--auth-config`; scriptul inspectează containerul local `supabase_auth_platforma-fonduri` și extrage doar setările Auth fără secrete. Hosted necesită fișierul explicit `--auth-config`, exportat din setările reale ale mediului și verificat de operator. Pentru local, atestă tracking-ul dezactivat prin `RESEND_LINK_TRACKING_DISABLED=true` în fișierul env explicit. Nu deduce setările hosted din `supabase/config.toml`. Fișierul JSON are numai următoarele câmpuri nesecrete:

   ```json
   {
     "minimumPasswordLength": 6,
     "passwordRequirements": "",
     "dbEncryptionEnabled": false,
     "otpExpiry": 3600,
     "disableSignup": true,
     "sendEmailHookEnabled": true,
     "sendEmailHookUri": "pg-functions://postgres/account_recovery/send_email_hook",
     "alternativeProvidersDisabled": true,
     "databaseRole": "supabase_auth_admin",
     "resendLinkTrackingDisabled": true
   }
   ```

   Câmpul `databaseRole` trebuie să ateste username-ul conexiunii `GOTRUE_DB_DATABASE_URL` din Auth-ul activ, nu rolul doar prezent în schemă. Local, scriptul extrage numai username-ul din URL în memorie și nu raportează URL-ul sau parola. Hosted, exportă username-ul conexiunii reale în acest câmp; nu îl deduce din `supabase/config.toml`.

   Preflight-ul citește doar fișierul trecut explicit; nu încarcă implicit `.env`. El face GET la Auth `/health` și `/settings` și apelează RPC-ul read-only `recovery_preflight()` cu service role. Raportul conține doar boolean-uri și stări, fără chei, adrese, URL-uri sau corpuri de răspuns. `ready` înseamnă că mediul este compatibil și încă dezactivat; `already_enabled` confirmă aceeași compatibilitate după activare; orice inconsecvență sau eroare este `blocked`. Scriptul nu activează funcția, nu trimite emailuri și nu modifică date sau config.
6. Activează numai după `ready`, folosind explicit RPC-ul service role `activate_account_recovery('v2.197.0')` pe proiectul verificat. Nu automatiza acest apel în scriptul de preflight.
7. Rulează din nou preflight-ul cu aceleași fișiere explicite; rezultatul așteptat este `already_enabled`. Confirmă apoi că dispatch-ul este programat și observă doar rezultatele operaționale redactate, fără linkuri sau parole.

## Efecte și limite

Activarea revocă toate sesiunile Auth existente și invalidează toate proof-urile native legacy, inclusiv recovery și confirmation. Utilizatorii trebuie să se autentifice din nou; parolele nu se schimbă. Planifică rollout-ul într-o fereastră anunțată și verifică înainte că metoda normală de login cu parolă rămâne disponibilă.

După activare, scrierea parolei prin Auth native Admin HTTP este blocată la nivel DB. Nu folosi Admin HTTP pentru resetări administrative: calea canonică viitoare din #108 trebuie să schimbe parola prin tranzacția DB suportată. Compatibilitatea demonstrată acoperă numai hashuri bcrypt `$2a$` cu costurile 05–10; pgcrypto nu acceptă `$2b$` sau `$2y$`. Formatele ori costurile din afara acestei dovezi blochează activarea și nu declanșează schimbări automate de parole. Resetările noi folosesc costul 10; Auth `v2.197.0` rehash-uiește doar hashurile cu cost 4 sau peste 10. Orice schimbare de versiune Auth, format bcrypt sau cost cere o nouă dovadă de compatibilitate înainte de actualizarea versiunii fixe `v2.197.0` / SDK `2.90.0`.

Nu face activare hosted dacă lipsesc dovezile pentru versiune, DB encryption, OTP expiry, hook, providerii alternativi, tracking Resend, URL-urile asociate sau cronul. Configurația hosted trebuie inspectată și exportată separat; modificarea fișierului local `supabase/config.toml` nu schimbă dashboard-ul hosted.