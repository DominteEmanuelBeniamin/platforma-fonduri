# Plan de implementare: Dosar intern al proiectului

## Scop și limite

Un singur dosar intern per proiect, vizibil numai administratorilor și consultanților membri ai proiectului. O înregistrare conține titlu, text și zero sau mai multe fișiere. Autorul și data sunt vizibile. Poate indica opțional **un** context: fază, activitate sau cerere de document din același proiect. Înregistrările fără context sunt perfect valide.

Dosarul oferă echipei o arhivă pentru note, rapoarte și fișiere care ajută la reluarea unui proiect. O cerere de document existentă aparține fluxului de lucru cu clientul și are propriile reguli de vizibilitate, status și notificare. Păstrarea înregistrărilor interne într-un dosar separat permite atât note generale, cât și referințe la o fază, activitate sau cerere, fără a le transforma în cereri către client sau a încărca interfața acestora. Stocarea separată permite și verificări de acces dedicate.

Clientul nu vede existența, metadatele sau conținutul dosarului, inclusiv prin API, Storage, căutare, calendar, notificări sau linkuri directe. Dosarul nu are stare de publicare și nu se poate transforma într-o cerere către client.

Nu intră acum: cereri sau sarcini interne cu responsabil/termen/status, foldere, etichete, notificări și propagare din șabloane.

De discutat ulterior: un indicator, vizibil numai echipei autorizate, în dreptul unei faze, activități sau cereri de document, care arată că aceasta este menționată în dosarul intern și de câte ori. În modalul cererii, indicatorul ar putea deschide dosarul la înregistrările relevante și le-ar putea evidenția. Pentru faze există loc în interfață; amplasarea pentru activități rămâne de decis, deoarece rândurile sunt deja încărcate. Referințele sunt păstrate în date, dar indicatorii și navigarea inversă nu sunt implementate în această versiune.

## Experiența utilizatorului

1. În pagina proiectului, numai echipa are tabul „Dosar intern”, separat de „Documente” (care include fișiere destinate fluxului cu clientul). Un link direct `?view=internal` funcționează numai pentru personalul autorizat.
2. Înregistrările sunt grupate după fază și activitate, cu grupuri pentru cele fără context și pentru cererile generale; grupurile și înregistrările se pot extinde. Autorul, data și contextul rămân vizibile în cardul închis. Căutarea din dosar și cea din proiect găsesc înregistrările, iar fișierele apar și în tabul Documente, marcate ca interne, numai pentru personalul autorizat. Crearea și editarea au loc într-un modal.
3. „Adaugă în dosar” cere titlu; textul și fișierele sunt opționale. Utilizatorul poate alege un singur context din fazele, activitățile și cererile proiectului, cu eticheta tipului. Serverul verifică apartenența contextului la proiect, inclusiv când cineva falsifică cererea.
4. Adminul sau orice consultant membru poate citi și adăuga. Autorul își poate corecta propria înregistrare; adminul și consultantul senior membru pot corecta/retrage orice înregistrare și pot retrage fișiere individuale. Retragerea este soft delete, cu audit, fără a șterge obiectul din Storage. Proiect încheiat: doar citire, pentru toți.
5. Fișierele se pot descărca printr-o rută care verifică accesul din nou. UI arată un eșec de upload fără să pretindă că fișierul a fost salvat și permite reluarea acțiunii.

## Date și securitate

- Tabel `project_internal_entries`: id, project_id, title, body, referință opțională (phase_id/activity_id/requirement_id, maximum una), created_by, created_at, updated_at, deleted_at/deleted_by. Chei externe pentru proiect și referințe; referința care dispare nu trebuie să șteargă înregistrarea. Index pe proiect și data creării.
- Tabel `project_internal_attachments`: id, entry_id, storage_path unic, original_name, mime_type, file_size, created_at, uploaded_by, deleted_at. Nu se reutilizează `files` sau `document_requirement_attachments`: acelea aparțin fluxurilor accesibile clientului.
- Bucket privat separat, `project-internal`, limită de 25 MiB per fișier, fără politică de SELECT/INSERT/UPDATE/DELETE pentru client. Accesul la metadate este numai prin rutele serverului; fără granturi directe `anon`/`authenticated` pe cele două tabele, cu RLS activ. Service client doar pe server.
- La inițiere, serverul verifică rolul, apartenența la proiect, starea activă și dimensiunea declarată; emite o cale aleatoare și URL de upload semnat. La confirmare verifică obiectul real din bucket, calea rezervată, dimensiunea și înregistrarea înainte de a salva metadatele. Descărcarea emite URL semnat cu durată scurtă, doar după autorizare; jurnalizează accesul. Nu acceptă căi arbitrare trimise de browser.
- Nu se refolosește bucketul `project-files`: politica lui actuală permite clientului citirea obiectelor din proiect când cunoaște calea. URL-urile semnate sunt temporare și sunt oferite numai utilizatorilor autorizați pentru încărcare sau descărcare; nu sunt trimise clientului proiectului ori în notificări.

## API și integrare

- `GET/POST /api/projects/[id]/internal-entries` — listare/creare, doar personal autorizat; scrierea folosește regula proiectului activ.
- `PATCH/DELETE /api/projects/[id]/internal-entries/[entryId]` — editare/retragere cu verificarea autorului sau a dreptului de manager; ținta din URL trebuie să aparțină proiectului.
- Rute de inițiere/confirmare upload și de descărcare sub aceeași ramură, întotdeauna autorizate. Respectă tiparul existent `requireProjectAccess`, `createSupabaseServiceClient`, audit și upload semnat.
- Componente dedicate dosarului și integrare în pagina proiectului, inclusiv căutarea și tabul Documente; înregistrările nu devin `document_requirements` și nu apar în chat sau calendar.
- Actualizare tipuri, manual de utilizare și teste unde contractele noi o cer.

## Verificare și acceptare

1. Admin, senior membru și junior membru pot lista, crea și descărca în proiectul permis. Consultant din afara echipei și clientul primesc refuz la fiecare rută, inclusiv cu ID-uri sau căi cunoscute. Browserul clientului nu primește tabul ori datele.
2. Juniorul nu poate modifica/retrage înregistrarea colegului; autorul o poate modifica; managerul o poate gestiona. Schimbarea rolului sau scoaterea din echipă revocă accesul la următoarea cerere.
3. Referința la entitate din alt proiect sau un fișier/cale falsă sunt refuzate. Fișierul chiar încărcat se poate descărca numai de personal autorizat. Proiectul încheiat se poate consulta, dar toate scrierile sunt refuzate până la redeschidere.
4. Verificări de bază: migrarea pe DB locală, teste API/acces/storage, lint, TypeScript, teste relevante și build. Recepție vizuală pentru desktop și telefon, inclusiv stare goală și eroare.

## Ordinea lucrului

1. Migrare și bucket privat; apoi API și probe de securitate.
2. UI-ul pe contractul API, manualul și testele de flux.
3. Revizie independentă a diffului, corecturi și o ultimă trecere de acceptare. Nicio publicare în producție ca parte a acestui plan.
