# Activarea account recovery (#107)

Migrațiile instalează mecanismul dezactivat. Activarea se face separat, numai după ce mediul țintă trece verificările de mai jos. Acest rollout este documentat pentru un mediu de preview izolat; nu face deploy și nu schimbă hosted settings.

## Ordinea de rollout

1. Aplică migrațiile în mediul ales și confirmă că setarea recovery rămâne `enabled=false`. Nu activa funcția în timpul aplicării schemei.
2. Configurează Auth înainte de activare: versiunea GoTrue exact `v2.197.0`, minimum password length `6`, fără cerințe suplimentare de parolă, DB encryption dezactivat, OTP expiry `3600`, signup dezactivat, hook-ul `pg-functions://postgres/account_recovery/send_email_hook` activ, toți providerii alternativi dezactivați și conexiunea DB reală GoTrue cu utilizatorul `supabase_auth_admin`. Simpla existență a rolului în schemă nu dovedește că Auth îl folosește. Dezactivează link tracking în setările expeditorului Resend.
3. Configurează variabilele server-only pentru mediul curent: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RECOVERY_SECRET`, `CRON_SECRET`, `RESEND_API_KEY` și `RESEND_FROM_EMAIL`. `SUPABASE_URL` trebuie să fie identic cu `NEXT_PUBLIC_SUPABASE_URL`. Păstrează `RECOVERY_SECRET` ca base64 canonic de exact 32 bytes. `NEXT_PUBLIC_APP_URL` este origine fără path, query sau fragment; preview și production folosesc HTTPS, iar development local poate folosi HTTP doar pe loopback. `REMINDER_EMAIL_OVERRIDE_TO` este obligatoriu în development și preview și interzis în production.
4. Configurează dispatch-ul durabil la fiecare minut prin Supabase Cron, conform secțiunii de mai jos, și păstrează cronul Vercel zilnic `/api/cron/deadline-reminders`. Proiectele Vercel curente sunt Hobby: configurarea Vercel la minut a fost refuzată de integrarea GitHub, conform [limitelor Vercel](https://vercel.com/docs/cron-jobs/usage-and-pricing). `vercel.json` păstrează doar cronul zilnic compatibil; nu este nevoie de schimbarea planului. După verificarea programării efective, setează `RECOVERY_DISPATCH_EVERY_MINUTE_CONFIGURED=true` în fișierul env explicit pentru preflight. Lipsa sau altă valoare blochează preflight-ul.
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

Activarea revocă toate sesiunile Auth existente și invalidează toate proof-urile native legacy, inclusiv recovery, confirmation și codurile PKCE din auth.flow_state. Apelul service-role a fost verificat prin Data API cu safeupdate activ. După activare, persistarea flow_state și emiterea unei sesiuni native inițiale fără password sunt blocate; MFA suplimentar după loginul cu parolă este păstrat. Utilizatorii trebuie să se autentifice din nou; parolele nu se schimbă. Planifică rollout-ul într-o fereastră anunțată și verifică înainte că metoda normală de login cu parolă rămâne disponibilă.

După activare, scrierea parolei prin Auth native Admin HTTP este blocată la nivel DB. Nu folosi Admin HTTP pentru resetări administrative: calea canonică viitoare din #108 trebuie să schimbe parola prin tranzacția DB suportată. Compatibilitatea demonstrată acoperă numai hashuri bcrypt `$2a$` cu costurile 05–10; pgcrypto nu acceptă `$2b$` sau `$2y$`. Formatele ori costurile din afara acestei dovezi blochează activarea și nu declanșează schimbări automate de parole. Resetările noi folosesc costul 10; Auth `v2.197.0` rehash-uiește doar hashurile cu cost 4 sau peste 10. Orice schimbare de versiune Auth, format bcrypt sau cost cere o nouă dovadă de compatibilitate înainte de actualizarea versiunii fixe `v2.197.0` / SDK `2.90.0`.

Nu face activare hosted dacă lipsesc dovezile pentru versiune, DB encryption, OTP expiry, hook, providerii alternativi, tracking Resend, URL-urile asociate sau cronul. Configurația hosted trebuie inspectată și exportată separat; modificarea fișierului local `supabase/config.toml` nu schimbă dashboard-ul hosted.

## Scheduler-ul Supabase pentru Vercel Hobby

Pe proiectul țintă dedicat, activează [Supabase Cron](https://supabase.com/docs/guides/cron/quickstart) și [pg_net](https://supabase.com/docs/guides/database/extensions/pg_net), apoi salvează în [Vault](https://supabase.com/docs/guides/database/vault) originea HTTPS exactă NEXT_PUBLIC_APP_URL ca issue107_app_origin și valoarea CRON_SECRET ca issue107_cron_secret. În cron.job se păstrează doar numele secretelor. Configurarea este un pas separat de deploy; migrația nu creează joburi sau secrete.

```sql
select cron.schedule(
  'issue107-recovery-dispatch',
  '* * * * *',
  $job$
    select net.http_get(
      url := (select decrypted_secret from vault.decrypted_secrets
              where name = 'issue107_app_origin') || '/api/auth/recovery/dispatch',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' ||
          (select decrypted_secret from vault.decrypted_secrets
           where name = 'issue107_cron_secret')
      ),
      timeout_milliseconds := 55000
    );
  $job$
);
```

Jobul aparține proiectului și mediului care emit emailurile. Verifică accesul privilegiat la Vault și cozile pg_net și că anon/authenticated nu pot citi secrete. Pentru un preview protejat Vercel, adaugă headerul [x-vercel-protection-bypass](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation) dintr-un secret Vault separat; nu pune secretul în URL sau în cron.job.

Confirmă două apeluri consecutive, la aproximativ un minut, către originea corectă, cu autorizarea aplicației. Cu configurația serverului validă, dispatch poate răspunde 200 cu processed=0 cât timp recovery este dezactivat; aceasta confirmă accesul HTTP, nu procesarea cozii. După activare, verifică și procesarea unei operații dedicate de test. Eșecurile și timeout-urile se verifică în rezultatele HTTP pg_net, nu doar în succesul comenzii SQL cron. Workerul are lease-uri și retry durabil, deci un apel omis este recuperat de următorul. Nu marca atestarea ca true doar pentru că jobul a fost inserat.

RECOVERY_DISPATCH_EVERY_MINUTE_CONFIGURED este o atestare explicită pentru preflight, nu creează un scheduler și nu certifică operarea remote. În harness, configurația este controlată pentru testarea gate-ului; scheduler-ul hosted nu a fost activat sau validat. Înainte de dezactivarea unui deployment/preview temporar, oprește și jobul acelui mediu prin cron.unschedule('issue107-recovery-dispatch').
