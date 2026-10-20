# #108 — Resetarea administrativă a parolei

Data: 19 octombrie 2026. Contract: https://github.com/DominteEmanuelBeniamin/platforma-fonduri/issues/108
Bază: main 92f2f60. Worktree separat issue-108-admin-password-reset, ramură codex/issue-108-admin-password-reset.

## Scop și decizii acceptate

Adminul activ resetează parola altui cont activ/eligibil din lista utilizatorilor și pagina existentă /admin/users/[id]. Panoul #106 nu există și nu se implementează aici; această ajustare a fost acceptată explicit. Adminul nu alege parola. Se refolosesc generatorul #103, formatul emailului, helper-ele existente și mecanismul atomic #107.

Resetarea confirmă într-un singur commit parola bcrypt $2a$10$, must_change_password=true, invalidarea permanentă recovery/cooldown, ștergerea credențialelor native și tuturor sesiunilor, receipt-ul încercării și auditul password_reset_completed cu source=admin_reset. Autorul este diferit de țintă. Cazurile deja stabilite în #105/#107 rămân valabile, inclusiv limitele URL-urilor semnate și emailurilor a căror predare a început.

Fără conturi inactive, Auth lipsă/banned/neconfirmat, email divergent, auth_sync_pending, cont propriu sau non-admin. Verificarea finală este în DB și include sesiunea autorului. Restricțiile Auth nu sunt eliminate.

Email: sent (acceptat, fără garanție de inbox), failed (refuz cert sau configurație care face imposibilă predarea), unknown (timeout/5xx/răspuns neconfirmabil), skipped (identitate/adresă/încercare/stare depășită). Numai failed poate permite fallback în răspunsul inițial, cu revalidare și claim atomic unic. Parola rămâne numai în memoria cererii și dialogului; nu există recuperare din istoric sau răspunsuri de retry. Un răspuns pierdut se confirmă prin aceeași încercare fără a doua resetare; altă parolă cere o acțiune nouă, confirmată.

## Dovezi și convenții înaintea implementării

- Citite AGENTS.md, ghidurile Next locale route-handlers/route și convențiile Radix/Surface/Button.
- Citite skill-urile ponytail, Supabase și Supabase Postgres (short transactions, consistent lock order).
- Preflight read-only existent: already_enabled, toate verificările trecute pe stack-ul local Auth v2.197.0 / SDK 2.90.0.
- #107 demonstrează mutația parolei/marker/sesiuni/audit într-un commit, cost10, invalidarea generațiilor și gărzile session_id. Nu se folosesc updateUser/Admin HTTP pentru password.
- DB local existent este partajat: probele #108 ating numai fixture-uri proprii; fără reactivare recovery, revocare globală, restart sau schimbare a configurației Auth. Nu se rulează harness-ul #107 care schimbă activarea globală.
- Checkout-ul principal are lucru din alt chat și rămâne neatins. Modificările sunt exclusiv în worktree; testele rulează cu porturi proprii 6260/6261 și mock local.

## 1. DB: receipt privat și tranzacția canonică

O singură migrare delta, creată cu CLI migration new. Tabel privat account_recovery.admin_password_resets: attempt_id unic, actor_id, user_id (FK auth.users ON DELETE CASCADE), email salvat, is_current, delivery_status (pending/sent/failed/unknown/skipped), motiv controlat, provider_id, delivery_audited, fallback_claimed, timestamps. Nu conține parola sau emailul renderizat. Receipt-ul fără secret păstrează identitatea încercării până la ștergerea țintei; nu se șterge după un TTL care ar permite unui retry vechi să reseteze din nou. Index pe user_id; RLS FORCE și privilegii restrictive, acces numai prin wrapper-ele service_role.

O gardă îngustă invalidează is_current pentru schimbări relevante în Auth (password/email/ban/deleted) și profil (email/is_active, inclusiv dezactivare/reactivare). Nu invalidează la nume/rol. Acoperă recovery_complete chiar dacă trigger-ul său existent evită invalidarea propriei generații. Nu se reconstruiesc triggerele #107 și nu se introduce un sistem general de versiuni. Trigger-ele rulează în aceeași tranzacție cu mutația. Resetarea nouă inserează receipt-ul după schimbările care invalidează încercarea precedentă.

Contract RPC (snake_case în DB):
- admin_reset_password(p_actor_id, p_actor_session_id, p_target_id, p_attempt_id, p_expected_email, p_password, p_ip_address default null, p_user_agent default null): lock (105,1), profiluri în ordine UUID, Auth țintă, verificare actor activ/admin/sesiune existentă; verificare țintă, adresă confirmată și coerență. Identitatea încercării este legată de actor și țintă. Replay-ul returnează numai rezultatul existent și ignoră parola propusă, fără mutații/audit duplicate. Rezultatul fresh: status=completed, replayed=false, attempt_id, email, full_name, role, nume_firma, is_current, delivery_status.
- admin_reset_password_prepare_delivery(p_actor_id,p_actor_session_id,p_target_id,p_attempt_id): revalidează actor/țintă/adresă/current și face claim unic, status=send ori skipped cu motiv controlat. Claim-ul pune rezultatul livrării unknown înainte de HTTP. Niciun lock DB nu rămâne deschis în timpul HTTP.
- admin_reset_password_finish_delivery(p_target_id,p_attempt_id,p_outcome default null,p_reason default null,p_provider_id default null): persistă rezultatul controlat, cu eveniment notify separat source=admin_reset_delivery. Datele actor/țintă provin din receipt. Nu reinterpretează un email acceptat ca omitted dacă invalidarea s-a produs după începerea predării. Un retry nu dublează evenimentul și nu înlocuiește arbitrar un rezultat terminal. Auditul livrării e separat într-o subtranzacție: eșecul păstrează rezultatul și delivery_audited=false; apelul cu outcome=null poate repara doar auditul din rezultatul salvat, fără email/parolă. Auditul resetării nu este best-effort.
- admin_reset_password_claim_fallback(p_actor_id,p_actor_session_id,p_target_id,p_attempt_id): allowed=true numai pentru failed, current, date coerente, actor activ/admin/sesiune validă, țintă eligibilă și claim încă neconsumat. Nu întoarce vreun secret.

Toate wrapper-ele sunt EXECUTE numai service_role; funcțiile interne sunt în schema privată, search_path=pg_catalog. Nu se adaugă un action_type nou: password_reset_completed + sursa admin_reset, respectiv notify pentru livrare. Excepția self_recovery din user_account_blockers nu acoperă aceste acțiuni; auditul administrativ blochează ștergerea autorului, iar ținta fără business rămâne ștergibilă și curăță receipt-ul operațional.

## 2. Server și reutilizarea emailului #103

POST /api/users/[userId]/reset-password, params Promise conform ghidului Next. Corp mic și validat strict: attemptId UUID și expectedEmail salvat. requireAdmin înainte de mutație; session_id din JWT deja validat este transmis pentru verificarea DB. Non-admin 403, lipsă sesiune 401, țintă lipsă 404, conflicte controlate 409, input invalid 400, indisponibilitate 503. Răspunsurile sunt no-store/no-referrer și fără erori SQL brute.

Se extrage numai template-ul/compoziția emailului de parolă temporară într-un helper comun, cu context welcome/admin_reset. Generatorul rămâne lib/temporary-password.ts. Crearea contului păstrează comportamentul existent. Textul resetării spune administrator, temporară, email cont, login și îndemnul la schimbare. Escaping/headers/from/override refolosesc helper-ele existente.

Emailul resetării folosește HTTP Resend bounded și configurație mock local permisă numai pe loopback/development, conform modelului #107. Trimiterea are loc numai pe rezultatul fresh după prepare_delivery; fără coadă nouă, scheduler sau stocare a parolei. Nu se fac retry-uri automate de resetare/livrare. timeout/5xx/409/429/răspuns 2xx fără ID cert => unknown; refuzurile 4xx certe => failed. Cheia este admin-password-reset/<attemptId>. Configurația invalidă este failed fără apel furnizor. După failed și finish se cere claim_fallback înainte de a adăuga temporaryPassword. Replay-ul nu trimite email și nu cere fallback, dar poate repara auditul livrării din starea salvată.

Răspuns API:
{ status:'completed', attemptId, replayed:boolean, deliveryStatus:'sent'|'failed'|'unknown'|'skipped', superseded?:boolean, deliveryAuditPending?:boolean, message:string, temporaryPassword?:string }
Un eșec de transport/DB cu commit necunoscut primește un mesaj de verificare a aceleiași încercări, fără afirmația că parola nu s-a schimbat. După commit confirmat, erorile ulterioare păstrează status=completed și avertisment; nu raportează falsa anulare a resetării.

## 3. UI în cele două amplasări acceptate

O singură componentă specifică ResetUserPasswordAction, folosită în listă și pagina /admin/users/[id]. Folosește useAuth/apiFetch, Radix Dialog și componentele locale Button/Surface/FeedbackMessage. Nimic despre tranzacții/SDK în textele produsului.

Ascunsă pentru cont propriu, țintă inactivă sau actor neadmin. Dialogul arată nume/email salvat și explică schimbarea parolei, închiderea sesiunilor și încercarea de email. Fiecare confirmare nouă creează un attemptId; dublul click are gardă sincronă și buton dezactivat. Eroarea de rețea păstrează attemptId și oferă verificarea aceleiași încercări. Buton separat explicit pentru o resetare nouă revine la confirmare. Închiderea/refresh-ul elimină secretul; răspunsurile întârziate după închidere/unmount nu repopulează dialogul sau alt utilizator. Fără local/sessionStorage pentru parolă. Focus, escape, descriere și avertismente accesibile; ținte touch 44px. Nu se modifică formularul de creare sau editarea rolurilor decât importul helperului de email pe server.

## 4. Delegare și acceptare

Subagenți gpt-6-luna, reasoning xhigh, în același worktree, cu proprietate clară:
1. DB: numai migrarea nouă și nota contractului RPC; fără aplicare sau teste/review proprii.
2. Server: helper template, helper reset, ruta POST și extragerea compoziției welcome; fără migrare/UI și fără teste/review proprii.
3. UI: componenta acțiunii și cele două pagini; fără server/DB și fără teste/review proprii.

Orchestratorul citește toate schimbările, scrie/rulează probele independente, controlează aplicarea locală, trimite instrucțiuni concrete de corectare până la acceptare. Nu se acceptă pe baza raportului unui subagent. Nicio implementare a #106, bibliotecă nouă, livrare hosted sau email real.

## 5. Matricea de acceptare independentă

- Pozitiv: client, junior/senior, alt admin; parola nouă funcționează, vechea e refuzată, marker true inclusiv resetare repetată când deja true.
- Privilegii: own/inactive/non-admin, Auth banned/missing/divergent/auth_sync_pending; sesiune actor revocată sau rol schimbat în curs; anon/authenticated nu pot citi tabelul sau apela RPC.
- Atomicitate: fault audit produce rollback hash/marker/recovery/native proofs/sesiuni/receipt; niciun succes fals.
- Idempotency: dublu submit și apeluri concurente au un singur hash/audit/livrare; receipt legat actor+țintă; răspuns pierdut și replay după resetare nouă nu modifică parola și nu întorc parola veche.
- Recovery/lifecycle: proof neconsumat și formular invalidat, cooldown gol; recovery nou poate finaliza și șterge marker; ambele ordini cu recovery/deactivate; A→B→A și deactivare/reactivare nu restaurează current/livrare/fallback.
- Acces: JWT/refresh/session vechi refuzate API și Data API/RPC/Storage; Realtime dacă există fixture relevant, cu limita fișierelor deja emise. Se reutilizează contractul #105, fără rescriere.
- Email: mock numai; accepted, definite rejection, lipsă config, timeout/5xx/2xx fără ID, skip pentru stare/adresă/încercare nouă; aceeași cheie/body când e cazul. Zero secret în replay/log/audit.
- Audit delivery: fault ulterior păstrează schimbarea și rezultatul cu pending audit; repararea nu trimite iar și nu schimbă parola.
- Ștergere: resetarea altui cont blochează autorul; ținta fără business poate fi ștearsă păstrând auditul; operaționalul se curăță.
- UI/browser desktop+mobil: cele două butoane, ascundere own/inactive, confirmare cu date salvate, rezultat/fallback, close/refresh elimină secretul, dublu click, rețea eșuată/retry și răspuns întârziat.
- Regresii: welcome email/template/generator, unitare existente, ESLint, TypeScript, build; testele sensibile cu trace/screenshot oprite când ar captura parole. Preflight și audit:check read-only, SQL lint/advisori locali dacă disponibili.
- Raport final cu rezultatele efective și limitele verificării; nu se declară activarea hosted. Worktree-ul rămâne disponibil pentru review.
