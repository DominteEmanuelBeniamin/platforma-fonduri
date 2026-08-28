# Plan de implementare — Issue #78

## Context și strategie de branch

Implementarea pornește din branch-ul curent, care conține deja modificările și migrările pentru #79 și #80. Nu este recomandată resetarea sau recrearea bazei de la `main`.

Înainte de cod:

1. Creează un branch nou pornind din branch-ul curent, de exemplu `feature/78-notifications`.
2. Verifică faptul că migrările #79/#80 sunt aplicate și că working tree-ul este curat.
3. Rulează un preflight read-only în Supabase: dependențe pentru `public.notifications`, overload-uri ale RPC-ului `create_notification`, consumatori externi și apartenența tabelului la `supabase_realtime`.
4. Integrează sau portează fixul de overflow din branch-ul #81 înaintea modificărilor Navbar; acesta atinge aceeași zonă de cod.

## Decizii de scope pentru v1

- Notificările sunt in-app, cu email acolo unde există deja un flux de email.
- Nu se adaugă outbox/worker, retenție, preferințe de categorie, notificări de chat sau backfill istoric.
- Nu se refactorizează template-urile de email.
- `notifications` are un singur `project_id`.
- Emailul de deadline rămâne un singur digest per destinatar și rulare, iar același digest produce câte o notificare in-app per proiect. Pentru un singur element, clickul deschide elementul; pentru mai multe, deschide proiectul.
- Review-ul este notificat imediat; un digest ulterior format numai din review-uri nu creează încă o notificare.
- Ordinea este notification-first, email-second: pentru digesturile publication/deadline, doar rândurile de notificare inserate în încercarea curentă se șterg înainte de eliberarea claims dacă emailul eșuează; rândurile preexistente nu se șterg. Dacă cleanup-ul eșuează, claims rămân pentru repair. Pentru evenimente de business deja comise (de exemplu assignment), notificarea rămâne, iar emailul este best-effort.
- Lista nu are retenție; API-ul folosește cursor `(created_at,id)`, cu 40 de rânduri inițiale și „Încarcă mai multe”.
- Citirea și ștergerea logică sunt acțiuni explicite; închiderea clopoțelului nu schimbă starea notificărilor.

## Faza 0 — Preflight și contract

Documentează contractul înainte de implementare:

- tipuri: `publication`, `assignment`, `deadline`, `document_action`;
- entități: `project`, `phase`, `activity`, `document_request`;
- regulile de destinatari și fallback-ul pentru assignment/reminder;
- politica de self-notification: acțiunile proprii rămân incluse, iar adminii primesc evenimentele din proiectele accesibile;
- `REMINDER_EMAIL_OVERRIDE_TO` modifică doar livrarea emailului, nu utilizatorul logic al notificării.

## Faza 1 — Schema, RLS și Realtime

Adaugă o migrare nouă, cu garduri explicite:

1. Verifică faptul că tabela veche este goală și că RPC-ul legacy poate fi șters cu `RESTRICT`.
2. Șterge funcția veche exactă, fără `CASCADE`.
3. Recreează tabela cu:
   - `id`, `user_id`, `project_id`, `type`, `entity_type`, `entity_id`;
   - `title`, `severity`, `actor_name`, `entity_label`, `item_count`, `event_key`, `created_at`, `read_at`, `dismissed_at`;
   - FK către utilizator și proiect;
   - CHECK pentru tipuri și `item_count > 0`;
   - UNIQUE `(user_id,event_key)`.
4. Adaugă indexuri pentru `(user_id,read_at,created_at,id)`, `(user_id,project_id,created_at,id)` și `event_key`.
5. Setează `REPLICA IDENTITY FULL` și re-adaugă tabela în publicația `supabase_realtime`.
6. Adaugă RLS: utilizatorul trebuie să fie proprietarul rândului, membru curent al proiectului și, pentru `document_request`, cererea trebuie să existe și să nu fie ștearsă.
7. Acordă doar `SELECT` browserului autentificat; inserările se fac server-side.
8. Actualizează tipurile Supabase generate/stale din repository.

Teste: migrare pe o bază goală, migrare pe baza curentă, verificare RLS cu utilizator/membru eliminat și verificare eveniment Realtime.

## Faza 2 — Helper server-side și API

Centralizează logica într-un helper server-side:

- `eventKey` stabil și idempotent;
- construire titlu și `item_count`;
- resolver de destinatari care validează membership-ul curent;
- inserare idempotentă prin `ON CONFLICT (user_id,event_key)`;
- resolver de target la momentul clickului, fără URL stocat în DB.

Adaugă endpoint-uri:

- `GET /api/notifications/summary` — total necitite și număr pe proiect;
- `GET /api/notifications` — listă paginată, filtre `projectId`, `unreadOnly`;
- `POST /api/notifications/read` — marchează rânduri accesibile ca citite;
- `POST /api/notifications/dismiss` — ascunde logic rânduri accesibile;
- `GET /api/notifications/[id]/target` — verifică accesul și returnează ruta curentă; pentru entitate dispărută răspunde 404.

Testează separat cursorul, filtrele, idempotency key, membership-ul și entitățile șterse.

## Faza 3 — Upload și review: evenimente in-app idempotente

### Upload

- La `init` se persistă rezervarea în `document_upload_batches` cu lista exactă; rândurile `files` primesc `upload_batch_id` numai la `completion`.
- Adaugă index unic parțial pe `(requirement_id, upload_batch_id, storage_path)`.
- Alocă versiunea atomic la `completion`, iar endpoint-ul `complete` folosește metadata server-side și verifică obiectele din Storage înainte de persistare; auditul și actualizarea statusului se execută o singură dată.
- Creează notificarea `document_action` pentru consultant/admin în aceeași tranzacție cu fișierele, auditul și actualizarea statusului.

### Review

- Adaugă unique `(requirement_id, reviewed_version_number)`.
- Protejează ruta cu status `review` și tratează retry-ul ca succes idempotent.
- Auditul și notificarea se creează în aceeași tranzacție, doar la primul insert.
- `notify-client` poate repara/upserta notificarea review-ului, dar digestul review-only nu creează un rând nou.
- `item_count` pentru publicații include doar faze/activități/documente, nu review-uri.

Teste: dublu submit, retry după timeout, concurență și digest numai cu review-uri.

## Faza 4 — Assignment, publicații și deadline-uri

Integrează helperul în producători:

- assignment activity: compare-and-set pe vechiul `assigned_to`, cu notificarea creată atomic de triggerul DB;
- assignment document request: notificarea este creată atomic de triggerul DB, iar emailul best-effort folosește rândul actualizat;
- publish/`notify-client`: notificare publication doar când există elemente relevante;
- deadline cron: resolver comun pentru responsabil și membership curent, grupare in-app per proiect, email digest existent păstrat per recipient;
- admini: notificare separată per proiect/eveniment, fără duplicate;
- eliminarea membrilor încă asignați este blocată; safe-delete pentru ștergerea părintelui activitate/fază copiază assignee-ul pe cererile mutate doar dacă mai este membru consultant activ;
- fiecare email primește aceeași cheie logică stabilă și idempotency key Resend.

Regula de eroare: dacă inserarea notificării eșuează, nu trimite emailul pentru acel eveniment; pentru digesturile publication/deadline, dacă emailul eșuează, șterge doar rândurile noi inserate în încercarea curentă înainte de eliberarea claims, fără să ștergi rânduri preexistente. Dacă ștergerea eșuează, păstrează claims pentru repair și întoarce eroare; pentru evenimente de business deja comise (de exemplu assignment), notificarea rămâne, iar emailul este best-effort.

Testează proiecte multiple, consultant scos din proiect, override email, retry cron și eșec parțial.

## Faza 5 — Provider, clopoțel și panou

- Creează `NotificationsProvider` separat de chat.
- Abonează-te Realtime filtrat pe `user_id`, apoi refă summary/lista prin API la eveniment.
- Refă lista la deschidere, focus și revenirea tabului; golește starea locală la închidere pentru revocarea accesului.
- Adaugă clopoțelul în Navbar folosind fixul de overflow din #81.
- Clopoțelul afișează lista scurtă, iar pagina `/notificari` oferă lista și controalele complete.
- Filtre: stare, categorie și proiect; empty states distincte pentru listă goală, filtru fără rezultate și eroare.
- Catalogul filtrului de proiecte se încarcă din `/api/projects`, independent de paginarea notificărilor.
- Nu marca automat notificările ca citite la închiderea clopoțelului.

## Faza 6 — Home și badge-uri

Separă `unreadChat` de `unreadNotifications`.

- Badge-ul de chat rămâne independent.
- Badge-ul de notificări folosește summary-ul nou.
- Filtrul „Necitite” include union-ul celor două surse.
- Curățarea globală are loc doar când ambele contoare sunt zero.
- Numărătoarea pe proiect folosește exclusiv notificări filtrate prin RLS/API.

## Faza 7 — Verificare și livrare

În fiecare fază rulează testele unitare relevante. La final:

- `pnpm test`
- `pnpm lint`
- `npx.cmd tsc --noEmit`
- build de producție
- test manual desktop + mobil pentru clopoțel, pagina `/notificari`, Realtime și membership revocation;
- test cron cu mai multe proiecte și test de retry pentru upload/review;
- verificare migrații pe staging înainte de producție.

## Criterii de acceptare

- Nicio notificare nu este vizibilă după pierderea accesului la proiect la următorul fetch/open.
- Nu există duplicate la retry pentru upload, review, cron sau email.
- Un digest review-only nu produce duplicate in-app.
- Notificările pentru deadline-uri din proiecte diferite nu se amestecă într-un singur rând in-app.
- Clickul pe notificare rezolvă ruta curentă sau rămâne pe pagina curentă cu feedback dacă entitatea nu mai există.
- Badge-urile Home și Navbar sunt corecte pe desktop și mobil.
