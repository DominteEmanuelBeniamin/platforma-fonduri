# Issue #105 — rezultatele fazei 0

Data: 5 octombrie 2026. Testarea a folosit numai stackul Supabase local existent din checkout-ul feat/safe-user-deletion. În faza 0 nu s-au aplicat migrări de produs și nu s-a scris în live sau staging; validarea ulterioară a migrării este consemnată la finalul documentului. Prototipul izolat a fost aplicat într-o singură tranzacție, testat, apoi schema temporară și triggerul Storage au fost eliminate.

## Decizia verificată

Dezactivarea/reactivarea și auditul trebuie să fie o singură funcție SQL service-only, într-o tranzacție DB. Nu este necesar un apel HTTP Admin API urmat de CAS și nu adăugăm versiuni de operație, worker sau outbox. Lockul advisory de tranzacție se ia înaintea lockurilor pe profil/Auth; apelurile opuse așteaptă și apoi aplică intenția lor în ordinea commiturilor.

La dezactivare, funcția setează profilul inactiv, păstrează ban-ul anterior și aplică un banned_until finit, apoi elimină sesiunile Auth. DML-ul Auth este într-un sub-block PL/pgSQL cu savepoint: dacă acesta eșuează, profilul rămâne inactiv, auditul tranziției se comite, iar un marker scalar auth_sync_pending permite retry. Reactivarea păstrează profilul inactiv dacă sincronizarea Auth eșuează. La succes, sesiunile sunt eliminate și înainte de activare, inclusiv când dezactivarea anterioară nu a salvat un marker de ban aplicat. Un ban independent este păstrat: retry-ul capturează o schimbare externă, iar reactivarea restabilește valoarea anterioară numai dacă ban-ul curent este exact cel aplicat de lifecycle. No-op/retry nu dublează auditul tranziției.

Eligibilitatea unei cereri DB se bazează simultan pe auth.uid(), claim-ul JWT session_id, rândul corespunzător din auth.sessions, profilul activ și expirarea ban-ului. Ștergerea sesiunilor face refresh-ul vechi invalid; helperul refuză și JWT-ul de access vechi chiar după unban. SDK-ul din repo cere JWT autentificat pentru auth.admin.signOut, nu user ID; un API call cu ID nu ar fi o alternativă validă.

Hard-delete-ul demonstrat este un RPC local care verifică blocantele și șterge auth.users în aceeași tranzacție cu auditul delete. Blochează profilul cu FOR UPDATE; inserarea unei referințe FK concurente fie devine un blocker vizibil, fie pierde la FK după commitul ștergerii. Un trigger temporar pe storage.objects cere profil existent pentru owner/owner_id și folosește FOR KEY SHARE; uploadul service cu owner NULL rămâne permis. Auditul este verificat explicit prin audit_logs.user_id, fără a depinde de FK. Triggerul append-only existent nu a fost schimbat. Eșecul auditului face rollback la ștergerea Auth.

## Mediu și compatibilitate observată

Runnerul a validat numai endpointuri locale (127.0.0.1/localhost) și un container DB existent. Nu a pornit, resetat sau șters containere. CLI-ul este 2.118.0; CLI-ul a anunțat 2.119.0 disponibil, dar nu a fost actualizat. Tagurile containerelor locale la test:

| Componentă | Tag |
| --- | --- |
| PostgreSQL | 17.6.1.171 |
| GoTrue/Auth | v2.197.0 |
| Storage API | v1.77.0 |
| Realtime | v2.135.3 |

supabase status a raportat oprite numai serviciile opționale imgproxy, edge runtime și pooler; testul nu a depins de ele. Au rămas neschimbate serviciile auxiliare. Înaintea oricărei aplicări pe alt mediu trebuie repetate verificările de catalog și testele pe versiunile efective; structura Auth/Storage este administrată de Supabase și această dovadă nu promite compatibilitate pe versiuni viitoare sau pe live.

Preflight-ul local a confirmat coloanele necesare pentru auth.users.banned_until, auth.sessions.id/user_id, profiles.is_active și storage.objects.owner/owner_id. Testul a folosit un ban finit, nu infinity. Runnerul a creat un JWT prin autentificare reală cu parolă, a folosit claim-ul session_id și a verificat refresh-ul prin GoTrue.

Ledgerul local conține intrările 20260925082720_audit_logs_preserve_actor_after_user_delete și 20260928000000_projects_template_id_index. Observația de catalog, fără a deduce conținutul acestor fișiere, este că local nu există FK pentru audit_logs.user_id, în timp ce inventarul live read-only a arătat un contract diferit. De aceea blockerul audit_logs.user_id este numărat explicit indiferent de FK, iar triggerul append-only este verificat, nu rescris.

## Probe capturate

Comenzi de validare:

    node --check scripts/issue-105-phase0.mjs
    node scripts/issue-105-phase0.mjs

node --check a trecut. Runnerul a ieșit cu codul 0 după test și cleanup. Liniile PASS din ieșirea efectivă:

    PASS: password login, refresh revocation, session_id eligibility, and old JWT rejection after unban.
    PASS: Auth DML failure savepoint leaves inactive/pending state; retry completes without duplicate audit.
    PASS: serialized local lifecycle transactions; previous independent ban preserved.
    PASS: hard-delete FK/audit/Storage blockers, real Auth deletion, and same-transaction audit rollback.
    PASS: FK and Storage profile-lock races; Storage owner trigger rejects deleted owner.

Erorile SQL SELF_ACCOUNT_ACTION, USER_HAS_RELATED_DATA, STORAGE_OWNER_PROFILE_REQUIRED și timeouturile injectate la audit au fost rezultate negative așteptate, verificate de runner; ele nu au fost eșecuri de aserție. Nicio cheie, parolă, JWT sau refresh token nu a fost scrisă în output.

După cleanup, interogarea read-only a întors:

    phase0_schema_absent=true,storage_trigger_absent=true,audit_append_only_present=true
    storage_prefix_count=0
    issue105_user_count=2
    retained_inactive_banned_without_sessions=2
    phase0_marked_audit_rows=28

Cei doi useri temporari rămași sunt actorul de test și contul folosit ca blocker explicit de audit. Ei rămân inactivi/ban-ați, fără sesiuni, deoarece triggerul append-only păstrează evenimentele lor de audit; nu sunt conturi de produs. Obiectele Storage temporare au fost șterse prin Storage API. Triggerul temporar și schema issue105_phase0 lipsesc; audit_logs_append_only este prezent. Ieșirea completă a procesului a fost capturată de invocarea runnerului, nu a fost salvată ca fișier separat; liniile PASS și rezultatul cleanup de mai sus sunt copiate din rezultatul acelei invocări.

## Catalog de acces și Realtime

Catalogul local nu are view/materialized view public cu SELECT acordat lui anon sau authenticated; acest rezultat nu se extrapolează la live. Inventarul live read-only a identificat exact public.measure_sessions_stats, public.project_stats și public.measures_overview. Căutarea callerilor din repo nu a găsit utilizări în aplicație; draftul de migrare revocă SELECT pentru anon/authenticated dacă aceste obiecte există și păstrează granturile service_role. security_invoker nu se aplică materialized view-urilor.

Pe local, has_function_privilege a raportat EXECUTE efectiv pentru 45 de funcții publice lui anon și 46 lui authenticated (inclusiv EXECUTE moștenit prin PUBLIC). Callerii browser confirmați sunt notification_unread_summary, mark_notifications_read, mark_notifications_unread și dismiss_notifications; draftul le păstrează cu verificarea sesiunii curente. Funcțiile SECURITY DEFINER folosite de politicile RLS își păstrează EXECUTE pentru authenticated, iar celelalte funcții SECURITY DEFINER publice pierd accesul PUBLIC/anon/authenticated; apelurile backend rămân pentru service_role. Acestea sunt intențiile draftului, nu schimbări deja aplicate.
Încercarea de aplicare a draftului numai pe local s-a oprit la `CREATE POLICY` pentru `storage.buckets_vectors` cu eroarea `must be owner of table buckets_vectors`; tranzacția întreagă a fost rollback-uită. Verificarea read-only de după rollback a confirmat că helperul nou și versiunea de migrare nu au rămas în catalog. Tabelele Storage au RLS, dar granturile authenticated pe ele nu înseamnă acces efectiv: numai `storage.objects` are politici permissive aplicabile, iar celelalte sunt deny-all. Corecția draftului păstrează toate tabelele public cu grant authenticated și aplică politica restrictive în Storage numai unde există deja o politică permissive aplicabilă rolului authenticated, inclusiv prin roluri moștenite, sau lui PUBLIC. Nu schimbă owner, granturi sau politici permissive.

Publicația locală supabase_realtime are publish=insert,update,delete,truncate, dar zero tabele, deci faza 0 nu demonstrează livrarea/revocarea pe canale locale. Catalogul live observat separat conține exact: private_conversations, private_conversation_participants, private_messages, project_chat_reads, notifications și project_chat_events. Draftul de migrare repară numai acești șase membri și setează publication events la INSERT/UPDATE; nu modifică DDL în schema administrată realtime. Validarea efectului asupra abonamentelor active, inclusiv absența evenimentelor DELETE și continuarea UPDATE/INSERT, rămâne un test E2E separat înainte de acceptare. În implementarea locală realtime.apply_rls, Postgres Changes verifică RLS per INSERT/UPDATE, dar DELETE ocolește RLS. realtime.list_changes citește acțiunile din flagurile publicației înainte de decodarea WAL, deci limitarea publicației oprește DELETE și pentru abonamente deja deschise. Cache-ul de autorizare este pentru Broadcast/Presence pe canale private; Postgres Changes verifică RLS per înregistrare pentru INSERT/UPDATE.

## Fișiere și delimitări

- Prototip temporar: [scripts/issue-105-phase0-prototype.sql](../scripts/issue-105-phase0-prototype.sql)
- Runner local: [scripts/issue-105-phase0.mjs](../scripts/issue-105-phase0.mjs)
- Nicio migrare de produs nu a fost aplicată de această fază.
- Nicio politică/grant live nu a fost modificată; triggerul append-only nu a fost editat.
- Testul nu șterge business data sau obiecte existente pentru a face un cont artificial gol; toate referințele și uploadurile create pentru probă au fost marcate și curățate.

Surse Supabase/PostgreSQL verificate: [Auth sessions și claim-ul session_id](https://supabase.com/docs/guides/auth/sessions), [ștergere Auth și limitele JWT](https://supabase.com/docs/guides/auth/managing-user-data), [Realtime DELETE nu este filtrat prin RLS](https://supabase.com/docs/guides/troubleshooting/realtime-messages-not-arriving), [publicația Realtime](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes), [Storage owner/owner_id](https://supabase.com/docs/guides/storage/security/ownership), [ALTER PUBLICATION în PostgreSQL 17](https://www.postgresql.org/docs/17/sql-alterpublication.html). Changelog-ul Supabase a fost citit prin HTTP text; confirmă faptul că se pot gestiona politicile realtime.messages, în timp ce schema realtime este protejată de DDL arbitrar.

## Validarea ulterioară a migrării de produs

Observațiile de mai sus descriu faza 0 și catalogul de la acel moment. Ulterior, migrarea `20261005103332_issue_105_account_lifecycle.sql` a fost aplicată numai pe stackul local, împreună cu înregistrarea proprie în ledger, fără reset sau reluarea migrărilor vechi. Corecțiile locale ale funcțiilor de blocante Storage și publicare găsite la review au fost validate înaintea acceptării; conținutul din ledger corespunde sursei finale.

Cele 8 teste lifecycle pe mecanismul de produs trec, inclusiv revocarea pe abonamente Realtime deja deschise, upload/review, savepoint Auth, rollback audit și concurența de ștergere/ultim admin. Publicația are acum cele șase tabele ale aplicației și numai INSERT/UPDATE. Schema temporară a fazei 0 și obiectele temporare ale testelor lipsesc; auditul append-only este păstrat. Rezultatele complete, mediul de test, cele 36 de E2E distincte și dependența CIF sunt consemnate în [acceptarea implementării](./issue-105-implementation-plan.md#acceptarea-implementării--5-octombrie-2026).
