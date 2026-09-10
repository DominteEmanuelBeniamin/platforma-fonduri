# PR #96 (issue #90) — chat cu imagini și linkuri interne: constatări din review și ce e de reparat

**PR:** [#96](https://github.com/DominteEmanuelBeniamin/platforma-fonduri/pull/96) — `codex/issue-90-project-chat-images-links` → `main`
**Autor:** tecs17 · **Data review-ului:** 2026-09-03 · **Stare PR:** deschis, zero review-uri, doar Vercel verde
**Dimensiune:** 39 fișiere, +3527 / −959

**Cum a fost verificat:** diff complet (`gh pr diff 96`), fișierele întregi citite din `git show pr-96:…`,
API-ul de storage verificat **în `node_modules/@supabase/storage-js@2.90.0`** (nu din documentație),
migrațiile existente căutate pentru constrângerile pe care se sprijină cele noi, plus
`npm test` și `npx tsc --noEmit` rulate pe branch-ul PR-ului.

**Rezultatele rulărilor:** `npm test` — **159/159 trecute** (afirmația din descrierea PR-ului se confirmă).
`npx tsc --noEmit` — curat; singurele erori sunt tipuri generate stale din `.next/` rămase de la
comutarea mea de branch, nu din codul PR-ului.

**Stare: aplicat, în afară de 1.5, 4.5 și jumătate din 1.3** — alea trei nu sunt cod
(verificare de webhook în dashboard, împărțirea PR-ului, `file_size_limit` pe bucket).
Reparațiile stau în 7 commit-uri peste `codex/issue-90-project-chat-images-links`, deci PR #96
se actualizează singur.

Cum a fost verificat după aplicare: `npx tsc --noEmit`, `npx eslint app components lib hooks scripts`
și `npm run build` trec curat; `npm test` — **161** de teste (159 existente + 2 noi pentru 1.2).
Testul pentru elementul mutat a fost pus la încercare pe codul de dinaintea reparației și **pică**
acolo, deci chiar prinde defectul. Commit-ul de normalizare a terminațiilor de linie e gol la
`git show -w`, iar în tot repo-ul nu mai există niciun fișier trackuit cu CRLF.

**Verificare vizuală** cu spec Playwright temporar peste `npm run dev`, cu ambele conturi reale din
`.env.e2e.local`, pe proiectul de test: 1.2, 2.1, 2.4, 2.5, 4.3 și 4.4 confirmate din capturi, nu
doar din aserțiuni. Testul de drop pe composer a fost și el pus la încercare pe codul vechi și pică
acolo. Spec-ul a fost șters după, iar cele 3 mesaje de chat create în timpul probelor au fost
șterse din DB împreună cu imaginea lor din storage — proiectul a rămas cu aceleași 8 mesaje.

**Ce a prins uitatul la captură și aserțiunile nu:** reparația de la 4.3 era pe jumătate. Scosesem
bulina din bara laterală, dar antetul fazei din panoul central desena același semnal de vizibilitate
(`app/projects/[id]/page.tsx:1151`), deci clientul rămânea cu un punct verde permanent lângă fiecare
titlu de fază. Reparat separat, în ultimul commit.

---

## Cum se lucrează pe fișierul ăsta

Ordinea e deja cea corectă: bug-uri de corectitudine → UX care blochează userul → eficiență →
cosmetic și igienă de repo. Ia-le în ordine, bifează pe măsură ce le rezolvi.

Înainte să începi:

```bash
git fetch origin pull/96/head:pr-96
git checkout pr-96
npm run dev
```

La final, pentru verificare:

```bash
npx tsc --noEmit
npx eslint app components lib hooks
npm test
npm run audit:check          # cere SUPABASE_SERVICE_ROLE_KEY în .env.local
```

Fișierele centrale ale PR-ului:

| Fișier | Rol |
|---|---|
| `lib/project-chat-contracts.ts` | constantele și tipurile comune (bucket, limite, MIME) |
| `lib/project-chat-links.ts` | parsarea și construirea href-urilor interne (partea tare a PR-ului) |
| `lib/project-chat-images.ts` | validarea numelor, path-urilor și metadatelor de imagine |
| `app/api/_utils/project-chat-links.ts` | mascarea server-side a referințelor nevizibile clientului |
| `app/api/_utils/project-chat-messages.ts` | serializarea mesajelor + semnarea URL-urilor |
| `app/api/projects/[id]/chat/images/init/route.ts` | signed upload URLs |
| `app/api/projects/[id]/chat/images/cleanup/route.ts` | ștergerea imaginilor abandonate |
| `app/api/projects/[id]/chat/messages/route.ts`, `…/[messageId]/route.ts` | CRUD-ul mesajelor |
| `components/ProjectChatDrawer.tsx` | compunerea, uploadul, chips-urile, lightbox-ul (1211 linii) |
| `hooks/useProjectChat.ts` | realtime pe `project_chat_events` + refetch prin GET |
| `app/projects/[id]/page.tsx` | navigarea din chat, highlight-ul, curățarea parametrilor |
| `supabase/migrations/20260901000000_project_chat_images_links.sql` | coloana `images`, tabela de evenimente, publicația realtime |
| `supabase/migrations/20260902000000_audit_logs_append_only.sql` | triggerul append-only pe `audit_logs` |

---

# 1. Bug-uri de corectitudine

## [x] 1.1 — Reînnoirea tokenului golește composerul și șterge imaginile deja urcate

**Unde:** `components/ProjectChatDrawer.tsx:159-171`

```ts
useEffect(() => {
  setAttachments([]);
  setText('');
  setPreview(null);
  setComposerError(null);
  setShowRequestCta(false);
  return () => {
    const items = attachmentsRef.current;
    items.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    const paths = items.map((item) => item.path).filter((path): path is string => !!path);
    if (paths.length) void cleanupPaths(paths, projectId);
  };
}, [cleanupPaths, projectId]);
```

Efectul e gândit ca „resetează composerul când se schimbă proiectul”, dar în dependențe stă
`cleanupPaths`, care e `useCallback(..., [apiFetch, projectId])` (`:147-157`), iar `apiFetch` e
`useCallback(..., [expireSession, token])` în `app/providers/AuthProvider.tsx:51,84`.

**Deci efectul se re-execută la fiecare schimbare de `token`, nu doar de proiect.**

**Input → rezultat greșit:** ai chatul deschis, ai scris jumătate de mesaj și ai atașat 3 imagini
(deja urcate în storage, cu `path` setat). Sesiunea Supabase se reînnoiește (JWT-ul are 1h,
`onAuthStateChange` cheamă `setToken` cu un string nou — `app/providers/AuthProvider.tsx:121`).
Fără niciun click al tău: **textul dispare, cele 3 preview-uri dispar**, iar funcția de cleanup
cheamă `/chat/images/cleanup` și **șterge din bucket imaginile deja urcate**. Utilizatorul nu
primește niciun mesaj; pentru el chatul pur și simplu s-a golit.

Același lucru se întâmplă la orice re-login într-un alt tab.

**Fix minim:** scoate `cleanupPaths` din dependențe, ținându-l într-un ref — resetarea trebuie
legată **numai** de `projectId`:

```ts
const cleanupPathsRef = useRef(cleanupPaths);
useEffect(() => { cleanupPathsRef.current = cleanupPaths; }, [cleanupPaths]);

useEffect(() => {
  setAttachments([]);
  setText('');
  setPreview(null);
  setComposerError(null);
  setShowRequestCta(false);
  return () => {
    const items = attachmentsRef.current;
    items.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    const paths = items.map((item) => item.path).filter((path): path is string => !!path);
    if (paths.length) void cleanupPathsRef.current(paths, projectId);
  };
}, [projectId]);          // ← singura dependență reală
```

**⚠️ Aceeași capcană e deja documentată în proiect** la efectul de deep-link din
`app/projects/[id]/page.tsx:640-645`, unde comentariul spune explicit „orice reîncărcare
ulterioară (o editare, **o reînnoire de token**) le înlocuiește cu un array nou și ar fi reaplicat
linkul”. Lecția a fost învățată acolo și pierdută aici.

**Verificare:** deschide chatul, scrie text + atașează o imagine, apoi în consolă forțează
`supabase.auth.refreshSession()`. Textul și atașamentele trebuie să rămână pe loc.

---

## [x] 1.2 — Ștergerea unei activități rupe definitiv toate linkurile din chat către cererile ei

**Unde (client):** `components/ProjectChatDrawer.tsx:333`
**Unde (server):** `app/api/_utils/project-chat-links.ts:77-110` (`visibleReference`)

Href-ul salvat în corpul mesajului e canonic și **conține activitatea**:
`/projects/<p>?phase=<X>&activity=<Y>&document=<Z>#activity-<Y>` (`lib/project-chat-links.ts:185-191`).

La randare, chip-ul se rezolvă căutând o potrivire **exactă de href** în indexul curent:

```ts
const result = searchIndex.find((entry) => buildProjectChatHref(projectId, entry) === part.href);
if (!result) return unavailableReference(index);
```

Iar serverul, pentru client, cere ca lanțul să fie intact:

```ts
request.activity_id === reference.activityId && visibleActivity(reference.phaseId, ...)
```

**Input → rezultat greșit:** un consultant pune în chat un link către cererea „Certificat fiscal”
din activitatea „Depunere dosar”. Peste o săptămână se șterge activitatea. Prin
`supabase/migrations/20260818000001_safe_parent_deletion.sql:79-96`, ștergerea unei activități
**nu șterge cererile — le mută la „Cereri generale”** (`set activity_id = null`).

Din acel moment `activity_id` e `null`, deci:
- pentru **client** serverul maschează → mesajul devine bulă chihlimbarie cu „Element indisponibil”;
- pentru **admin/consultant** serverul **nu** maschează, dar `searchIndex` nu mai conține o intrare
  cu acel href → chip-ul devine tot „Element indisponibil”, **fără bula chihlimbarie și fără nota
  explicativă**, deci fără nicio indicație de ce.

În ambele cazuri **textul URL-ului e distrus la randare** — utilizatorul nu poate nici măcar să
citească sau să copieze unde ducea linkul. Cererea, între timp, există și e perfect vizibilă în
„Cereri generale”.

Același drum se parcurge și la ștergerea unei faze (`:181` în aceeași migrare).

**De ce e o problemă de corectitudine, nu de UX:** linkul e stocat ca text imutabil, dar e rezolvat
prin egalitate de string cu o formă derivată din date mutabile. Orice mutare legitimă a cererii
rupe linkul, pentru toată lumea, ireversibil.

**Fix minim:** rezolvă după **id**, nu după href. Pe client:

```ts
const ref = part.reference
const result = searchIndex.find((entry) =>
  entry.type === ref.type && entry.id === (ref.type === 'document_request' ? ref.requestId : ref.id)
)
```

și, când `result` există dar href-ul curent diferă, navighează cu `buildProjectChatHref(projectId, result)`
(poziția de azi), nu cu `part.href` (poziția de atunci).

Pe server, în `visibleReference`, pentru `document_request` verifică vizibilitatea **cererii**
(`project_id`, `deleted_at`, `visibility`) și, dacă are `activity_id`, a lanțului ei **curent** —
nu potrivirea cu `reference.activityId` din href.

**NU** rezolva asta transformând linkul în text simplu la mutare: pierzi exact funcția pentru care
s-a scris tot `lib/project-chat-links.ts`.

**Verificare:** pune în chat un link către o cerere dintr-o activitate, șterge activitatea, apoi
deschide chatul ca admin. Chip-ul trebuie să rămână funcțional și să te ducă în „Cereri generale”.

---

## [x] 1.3 — Serverul respinge imaginea prea mare, dar obiectul rămâne în bucket

**Unde:** `app/api/projects/[id]/chat/images/init/route.ts:18` și
`app/api/projects/[id]/chat/messages/route.ts:78-96,161-164`

La `init`, dimensiunea vine **din client** și e doar validată ca număr:

```ts
const validation = validateProjectChatImageUploads((body as { files?: unknown }).files)
// lib/project-chat-images.ts:112-119 — file.size < 1 || file.size > PROJECT_CHAT_MAX_IMAGE_BYTES
```

Serverul semnează un upload URL pentru path și îl întoarce. Abia la `POST /messages` se citește
dimensiunea reală din storage:

```ts
const stored = toStoredProjectChatImage(image.path, image.name, data)
if (!stored || stored.size < 1 || stored.size > PROJECT_CHAT_MAX_IMAGE_BYTES) return null
...
return Response.json({ error: 'One or more uploaded images are missing or invalid' }, { status: 400 })
```

**Input → rezultat greșit:** un client (orice membru al proiectului trece de `requireProjectAccess`)
cheamă `init` cu `{ name: "a.png", size: 100, type: "image/png" }`, apoi face PUT pe URL-ul semnat
cu un fișier de 4 GB. Mesajul e respins cu 400 — corect — dar **obiectul de 4 GB rămâne în bucket**.
Curățarea se face doar dacă clientul cheamă politicos `/chat/images/cleanup`
(`components/ProjectChatDrawer.tsx:632`) sau abia la ștergerea proiectului. Repetat, umple storage-ul.

**⚠️ Verifică întâi în dashboard-ul Supabase dacă bucket-ul `project-files` are `file_size_limit`
setat.** Nu e creat prin migrare — nu există niciun `create bucket` în `supabase/migrations/` — deci
nu se poate afla din repo. Dacă limita e setată la 10 MB, gaura e închisă de infrastructură și
rămâne doar fixul mic de mai jos. Dacă nu e setată, e o gaură reală.

**Fix minim (indiferent de bucket):** pe drumul de respingere din `POST /messages`, șterge ce ai
inspectat și ai găsit invalid — serverul nu trebuie să depindă de bunăvoința clientului:

```ts
const storedImages = await inspectStoredImages(admin, parsed.data.images)
if (!storedImages) {
  await admin.storage.from(PROJECT_CHAT_BUCKET)
    .remove(parsed.data.images.map(image => image.path))
    .catch(() => {})   // best effort, ca la DELETE
  return Response.json({ error: 'One or more uploaded images are missing or invalid' }, { status: 400 })
}
```

**Aplicat: fixul de server**, dar prin verificarea de referințe, nu prin `remove` direct — lotul
respins poate conține și un path pe care îl mai ține un mesaj trimis mai devreme, iar acela nu are
voie să dispară.

**⚠️ Corectură la ce scrisesem inițial: 10 MB pe bucket ar fi fost greșit.** Am verificat bucket-ul:
`file_size_limit` e `null`, deci gaura era reală — dar `project-files` e **partajat cu atașamentele
de documente**, care au voie până la 25 MB (`lib/document-action-idempotency.ts:2`,
`MAX_UPLOAD_FILE_SIZE`). O limită de 10 MB ar fi rupt uploadurile legitime de documente. La fel,
`allowed_mime_types` restrâns la cele patru tipuri de imagine ar fi blocat orice PDF sau document.

**Rămâne de făcut (dashboard, nu cod):** `file_size_limit = 26214400` (25 MB) pe `project-files` —
atât cât acceptă oricum aplicația, deci nu respinge nimic ce trece azi, dar mărginește abuzul la
25 MB per obiect în loc de nelimitat. **Nu** atinge `allowed_mime_types`. Imaginile de chat rămân
limitate la 10 MB de server.

---

## [x] 1.4 — Ștergerea proiectului depinde acum de o listare de storage care poate eșua, cu o opțiune inexistentă

**Unde:** `app/api/projects/[id]/route.ts:299-329`

```ts
const options = {
  prefix: chatPrefix,
  limit: 1000,
  ...(cursor ? { cursor } : {}),
  withHierarchy: false,          // ← opțiunea asta nu există
}
const { data: listed, error: listError } = await admin.storage.from(bucket).listV2(options)

if (listError || !listed) {
  return NextResponse.json({ error: 'Failed to load project chat files' }, { status: 500 })
}
```

**Două probleme, una mică și una mai mare.**

**(a) `withHierarchy` nu e un câmp din `SearchV2Options`.** Verificat direct în
`node_modules/@supabase/storage-js/dist/index.d.cts:150-178` — câmpurile sunt `limit`, `prefix`,
`cursor`, **`with_delimiter`**, `sortBy`. Nu dă eroare de compilare pentru că `options` e o variabilă,
nu un obiect literal pasat inline, deci TypeScript nu face excess property check. La runtime cheia e
ignorată. Comportamentul e corect din întâmplare — `with_delimiter` are default `false`, exact ce se
voia — dar linia arată ca și cum ar face ceva și nu face. Șterge-o sau scrie `with_delimiter: false`.

**(b) Metoda e marcată `@experimental` în SDK** („this method signature might change in the future”,
`index.d.cts:931`), iar orice eșec al ei **oprește complet ștergerea proiectului** cu 500. Înainte de
PR, ștergerea nu depindea deloc de o listare de storage.

**Fix minim:** ține sweep-ul, dar nu-l lăsa să blocheze ștergerea. Imaginile de chat sunt oricum
recuperabile prin prefix mai târziu:

```ts
if (listError || !listed) {
  console.error('Fetch project chat storage paths error:', { projectId, listError })
  break        // continuă ștergerea; obiectele rămase se pot mătura separat
}
```

Dacă preferi să nu lași gunoi în bucket, alternativa e `admin.storage.from(bucket).list(chatPrefix, …)`
(API stabil), recursiv pe `projects/<id>/chat/<userId>/` — două niveluri, cunoscute din
`projectChatImagePrefix`.

**Verificare:** șterge un proiect care are imagini în chat și confirmă că `projects/<id>/chat/`
rămâne gol; apoi simulează o eroare de listare și confirmă că proiectul tot se șterge.

---

## [ ] 1.5 — Migrația mută publicația realtime; confirmă că n-a rămas nimeni pe tabela veche

**Unde:** `supabase/migrations/20260901000000_project_chat_images_links.sql:106-124`

```sql
execute 'alter publication supabase_realtime drop table public.project_chat_messages';
...
execute 'alter publication supabase_realtime add table public.project_chat_events';
```

Am căutat abonații rămași în cod și **nu mai e niciunul** — `hooks/useProjectChat.ts:414-420` și
`app/providers/ProjectChatUnreadProvider.tsx:45` au fost amândoi mutați pe `project_chat_events`.
Deci în repo e curat.

**Ce rămâne de verificat manual (nu se poate afla din cod):** dacă în Supabase există vreun webhook,
funcție edge sau integrare care ascultă pe `project_chat_messages`. Un `drop table` din publicație
**nu dă nicio eroare** — abonatul pur și simplu nu mai primește nimic, tăcut. Ăsta e genul de
regresie care se descoperă peste două săptămâni.

**De verificat înainte de aplicare:**

```sql
select pubname, schemaname, tablename
from pg_publication_tables
where tablename in ('project_chat_messages', 'project_chat_events');
```

și o privire în Database → Webhooks din dashboard.

**⚠️ Migrația de audit (`20260902000000`) a fost deja aplicată manual în Supabase**, după descrierea
PR-ului. Cea de chat (`20260901000000`) **nu** — și trebuie aplicată *înainte* de merge, altfel
producția primește cod care scrie în `project_chat_messages.images`, coloană care nu există.

---

# 2. UX care blochează userul

## [x] 2.1 — Dai drop cu imaginea pe composer și browserul îți deschide fișierul, pierzi tot ce ai scris

**Unde:** `components/ProjectChatDrawer.tsx:715-731`

`onDragEnter` / `onDragOver` / `onDrop` sunt puse **doar pe containerul listei de mesaje** (`listRef`).
Composerul, zona de preview a atașamentelor și headerul nu au niciun handler, și nu există nici un
`preventDefault` global pe `window`.

**Input → rezultat greșit:** ai scris un mesaj lung, tragi o captură de ecran și o lași peste
composer — ținta intuitivă, imediat lângă butonul „adaugă imagini”. Browserul aplică
comportamentul implicit: **navighează la fișier**. Pagina proiectului se pierde, mesajul scris
se pierde, atașamentele deja urcate rămân orfane în bucket.

**Fix minim:** mută handlerele de drag pe `<aside>`-ul drawerului, nu pe lista de mesaje — acoperă
și lista, și composerul, cu același cod:

```tsx
<aside
  onDragEnter={(event) => { event.preventDefault(); if (!uploading && !sending) setDragActive(true); }}
  onDragOver={(event) => event.preventDefault()}
  onDragLeave={(event) => { if (event.currentTarget === event.target) setDragActive(false); }}
  onDrop={(event) => { event.preventDefault(); setDragActive(false); addFiles(Array.from(event.dataTransfer.files)); }}
  …
>
```

și scoate-le de pe `listRef`, ca să nu rămână duplicate. Overlay-ul „Lasă imaginile aici” poate
rămâne unde e.

**Verificare vizuală:** trage un PNG peste composer, peste banda de preview și peste header. În
toate trei cazurile trebuie să apară overlay-ul și imaginea să ajungă în atașamente, iar pagina să
nu se schimbe.

---

## [x] 2.2 — La eșec, userul primește două mesaje de eroare diferite, unul sub altul

**Unde:** `components/ProjectChatDrawer.tsx:626-635` și `hooks/useProjectChat.ts:386-389`

`handleSend` cheamă `sendMessage`, care la eșec își setează **propria** eroare în hook
(`setError(userErrorMessage(res.status, 'Nu am putut trimite mesajul.'))`) și întoarce `null`.
`handleSend` interpretează `null` ca eșec, aruncă, și în `catch` mai setează una:

```ts
setComposerError('Nu am putut încărca imaginile sau trimite mesajul. Reîncearcă.');
```

Ambele se randează: `error` prin `FeedbackMessage`, `composerError` în caseta roz de deasupra
composerului. Utilizatorul vede două formulări diferite pentru același eșec, în două stiluri
diferite, în același ecran.

**Fix minim:** `composerError` să acopere **doar** partea de upload, nu și trimiterea — de trimitere
se ocupă deja hook-ul:

```ts
try {
  let references: { path: string; name: string }[] = [];
  if (attachments.length) {
    …                                     // tot ce e upload rămâne în try
  }
  const item = await sendMessage({ body: text, images: references });
  if (!item) return;                      // hook-ul a afișat deja eroarea
  setText(''); clearAttachments();
  setTimeout(() => scrollToBottom(false), 0);
} catch {
  await cleanupPaths(initializedPaths);
  setAttachments((prev) => prev.map((item) => ({ ...item, path: undefined })));
  setComposerError('Nu am putut încărca imaginile. Reîncearcă.');
} finally {
  setUploading(false);
}
```

**⚠️ Regulă de respectat:** nu adăuga un al treilea loc de afișare a erorilor. Convenția din #70 e
că motivul real vine prin `message`, nu prin `error` — vezi cum e rescris `error` în
`app/providers/AuthProvider.tsx:70-81`. Dacă vrei motivul concret al serverului la upload, citește
`message`, nu `error`.

---

## [x] 2.3 — Fiecare click pe un link din chat adaugă o intrare în istoric

**Unde:** `app/projects/[id]/page.tsx:813`

```ts
router.push(buildProjectChatHref(projectId, result), { scroll: false })
```

Restul fișierului navighează consecvent cu `router.replace` — `selectView` (`:254`), efectul de
deep-link, `jumpToActivity`. Doar drumul din chat folosește `push`.

**Input → rezultat greșit:** deschizi chatul, dai click pe 5 linkuri ca să te uiți prin proiect,
apoi apeși Back ca să te întorci la lista de proiecte. Trebuie să apeși de 6 ori. Pe telefon, unde
Back e gestul principal, e enervant imediat.

**Fix minim:** `router.replace(buildProjectChatHref(projectId, result), { scroll: false })`.

**NU** scoate complet actualizarea URL-ului: parametrii sunt ce fac linkul partajabil și ce
alimentează `handleToggleExpand` / `handleToggleAllPhases` când curăță starea (`:561-563`, `:606-608`).

---

## [x] 2.4 — Highlight-ul rândului de cerere e desenat sub modalul care tocmai s-a deschis

**Unde:** `app/projects/[id]/page.tsx:807-813` și `:127-150` (`revealTarget`)

```ts
if (result.type === 'document_request') setSelectedDocumentRequestId(result.id)
…
revealTarget(anchor)      // anchor = `request-${result.id}`
```

`setSelectedDocumentRequestId` deschide `DocumentModal` peste toată pagina. `revealTarget` pornește
la 120 ms și animă `boxShadow` timp de 1800 ms pe rândul `#request-<id>` — care în tot acest timp
stă **sub modal**. Utilizatorul nu vede niciodată highlight-ul, deși descrierea PR-ului îl dă drept
funcție livrată („highlight-ul se aplică rândului cererii respective, nu întregii activități”).

**Fix minim (alege unul):**

- **A.** Nu porni highlight-ul când deschizi și modalul — la o cerere, modalul *este* destinația.
  Rezolvă pentru `request-*`, lasă `activity-*` și `phase-*` neatinse.
- **B.** Amână highlight-ul până la închiderea modalului, pornindu-l din `onClose`-ul lui
  `DocumentModal` (`:1336`). Mai mult cod, dar userul chiar vede unde a ajuns când se întoarce în pagină.

**Recomandarea mea: B** — altfel, după ce închizi fișa, nu mai ai nicio idee din ce activitate venea
cererea, ceea ce era exact rostul highlight-ului.

**Verificare vizuală:** captură Playwright la 1 s după click pe un chip de tip „Cerere”, apoi încă
una la 1 s după închiderea modalului. Uită-te la ele — inelul trebuie să fie vizibil în a doua.

---

## [x] 2.5 — Un mesaj rămas doar cu imagini nu mai poate fi editat niciodată

**Unde:** `components/ProjectChatDrawer.tsx:997`

```tsx
{!m.body_masked && m.body && (
  <button …>Editează</button>
)}
```

Serverul acceptă `PATCH { body: null }` pe un mesaj cu imagini
(`app/api/projects/[id]/chat/messages/[messageId]/route.ts:174-176`) — corect, altfel n-ai putea
șterge textul dintr-un mesaj cu poze. Dar odată ce `body` a devenit `null`, condiția de mai sus e
falsă și **butonul „Editează” dispare definitiv**. Nu mai poți adăuga text înapoi; singura ieșire e
să ștergi mesajul și să reîncarci imaginile.

Același lucru pentru un mesaj trimis de la început doar cu imagini, fără text.

**Fix minim:** condiția trebuie să fie „mesajul e al meu / sunt admin și nu e mascat”, nu „are text”:

```tsx
{!m.body_masked && (
  <button … onClick={() => { setOpenMenuId(null); startEdit(m.id, m.body ?? ''); }}>
    Editează
  </button>
)}
```

`startEdit` primește deja `string`; dă-i `''` când `body` e `null`. `saveEdit` merge neschimbat —
`editMessage` normalizează `''` la `null` (`hooks/useProjectChat.ts:211-213`).

---

# 3. Eficiență

## [x] 3.1 — `npm run audit:check` citește tot jurnalul de audit ca să afle ce valori distincte există

**Unde:** `scripts/check-audit-contract.mjs:145-159`

```js
for (let offset = 0; ; offset += pageSize) {
  const data = await readProbe(…, () => admin
    .from('audit_logs')
    .select('action_type,entity_type')
    .order('id', { ascending: true })
    .range(offset, offset + pageSize - 1))
  …
}
const actionTypes = [...new Set(rows.map(row => row.action_type))]
```

Ca să obții ~15 valori distincte, tragi prin PostgREST **fiecare rând din `audit_logs`**, câte 1000.
Acum, cu jurnalul mic, trece; peste un an de logare de fiecare acțiune, scriptul devine minute și
trafic degeaba — pe un tabel care, prin definiție, doar crește și nu se mai șterge niciodată
(tocmai asta face migrarea append-only).

**⚠️ Corectură la propunerea inițială:** scrisesem „ia valorile din endpointul de statistici, care
le agregă deja în DB". E greșit — l-am citit după aceea: `/api/audit?action=stats` face
`select('action_type')` fără limită și **fără paginare** (`app/api/audit/route.ts:136-168`), deci are
aceeași problemă și, în plus, vede tăcut doar primele 1000 de rânduri returnate de PostgREST. Lista
de filtre din pagina de audit e, prin urmare, incompletă fără să dea vreun semn. E o problemă
preexistentă, nu din PR-ul ăsta — nu am atins-o, dar merită un issue.

**Fix aplicat:** agregarea se face în DB, printr-un RPC, iar scriptul cade înapoi pe scanarea
paginată dacă migrarea nu e încă aplicată:

```sql
create or replace function public.audit_log_distinct_types()
returns table (action_type text, entity_type text)
language sql stable as $$
  select distinct action_type, entity_type from public.audit_logs
$$;
```

**Atenție:** păstrează detecția de `unrenderable` (valori non-string sau goale) — e partea utilă a
verificării și funcționează la fel pe valori distincte.

---

## [x] 3.2 — Verificarea referințelor face o interogare pe imagine, secvențial

**Unde:** `app/api/projects/[id]/chat/images/cleanup/route.ts:32-46` și
`app/api/projects/[id]/chat/messages/[messageId]/route.ts:92-102` (aceeași buclă)

Ambele fac același lucru: buclă `for` peste path-uri, câte un `select … contains('images', [{path}])`
per path, `await` în serie. Maximum 5 imagini, deci 5 round-trip-uri unde ar fi de ajuns unul.

**Fix minim:** o singură interogare cu `or`, apoi filtrare în memorie:

```ts
const { data, error } = await admin
  .from('project_chat_messages')
  .select('images')
  .eq('project_id', projectId)
  .is('deleted_at', null)
  .or(uniquePaths.map(path => `images.cs.${JSON.stringify([{ path }])}`).join(','))
if (error) throw error
const referenced = new Set(
  (data ?? []).flatMap(row => imageRows(row.images).map(image => image.path)).filter(path => uniquePaths.includes(path))
)
```

**Mai important decât cele 5 round-trip-uri:** logica e **duplicată integral** în două fișiere.
`cleanupUnreferencedImages` din ruta de `[messageId]` și corpul rutei de `cleanup` fac aceeași
verificare cu același cod. Mută-le într-un singur `app/api/_utils/project-chat-images.ts` și
cheamă-l din ambele locuri — vezi și 4.2, care e un simptom al aceleiași duplicări.

---

## [x] 3.3 — Fiecare eveniment realtime declanșează un GET la fiecare client, inclusiv la autor

**Unde:** `hooks/useProjectChat.ts:414-448`

Vechiul handler de INSERT avea o scurtătură care s-a pierdut la rescriere:

```ts
if (idsRef.current.has(id)) return      // ← nu mai există
```

Acum, orice eveniment (`created`, `updated`) duce necondiționat la
`GET /chat/messages/<id>`. Autorul mesajului tocmai a primit obiectul complet din răspunsul
POST-ului și l-a pus în listă cu `pushOne`; evenimentul realtime îl face să-l ceară din nou.
Cu N persoane în chat, un mesaj înseamnă N cereri, dintre care una e garantat inutilă.

**Fix minim:** pune înapoi scurtătura, dar **numai pentru `created`** — la `updated` refetch-ul e
tocmai ideea (aplică din nou autorizarea și semnează URL-urile):

```ts
if (row?.event_type === 'created' && idsRef.current.has(id)) return
```

**NU** extinde scurtătura la `updated`: acolo mesajul e deja în listă prin definiție, și dacă sari
peste fetch nu mai afli conținutul editat.

---

# 4. Cosmetic / igienă de repo

## [x] 4.1 — Trei fișiere convertite din CRLF în LF umflă diff-ul cu ~380 de linii de zgomot

**Unde:** `app/api/projects/[id]/chat/messages/route.ts`,
`app/api/projects/[id]/chat/messages/[messageId]/route.ts`, `app/api/projects/[id]/route.ts`

Fișierele vechi aveau CRLF, cele noi au LF. De aia primele două apar în diff ca **rescrise integral**,
deși modificările reale sunt o fracțiune. Verificat: 390 de linii șterse se termină în `\r`, zero
linii adăugate. Efectul e că `git blame` pe rutele de chat arată acum tecs17 pe fiecare linie, și
review-ul liniilor chiar schimbate e imposibil fără `-w`.

Repo-ul **nu are `.gitattributes`**, deci fenomenul se va repeta ori de câte ori cineva editează de
pe Windows.

**Fix minim, într-un commit separat, înainte de orice altceva:**

```bash
printf '* text=auto eol=lf\n' > .gitattributes
git add --renormalize .
git commit -m "chore: normalizează terminațiile de linie la LF"
```

**NU** îl amesteca în PR-ul de funcționalitate — ar reface exact problema pe care o rezolvă.

---

## [x] 4.2 — Verificare tautologică de path la curățarea imaginilor

**Unde:** `app/api/projects/[id]/chat/messages/[messageId]/route.ts:87-90`

```ts
const candidates = [...new Set(imageRows(images)
  .map(image => image.path)
  .filter(path => isProjectChatImagePath(path, projectId, path.split('/')[3] ?? '')))]
```

`isProjectChatImagePath(path, projectId, userId)` verifică, printre altele, că path-ul începe cu
`projects/<projectId>/chat/<userId>/`. Dar `userId` e extras **din path-ul verificat** —
`path.split('/')[3]` e exact segmentul de userId. Verificarea acelui segment nu poate eșua.

Nu e o gaură de securitate: path-urile vin din rândul din DB, nu de la client, iar restul verificării
(prefixul de proiect, forma `uuid_nume`) chiar funcționează. Dar linia se citește ca și cum ar
valida proprietarul, și nu o face — exact genul de cod care păcălește următorul cititor.

**Fix minim:** ia userId din rândul mesajului, care e chiar acolo:

```ts
.filter(path => isProjectChatImagePath(path, projectId, message.created_by))
```

Dacă un path nu e al autorului, e o anomalie care merită să nu fie ștearsă tăcut.

---

## [x] 4.3 — Bulina de vizibilitate rămâne pe ecranul clientului; s-a scos doar tooltipul

**Unde:** `components/ProjectPhasesSidebar.tsx:479`

```tsx
<span
  title={canEdit ? (phase.visibility === 'published' ? 'Public — …' : 'În pregătire — …') : undefined}
  className="w-2 h-2 rounded-full flex-shrink-0"
  style={{ backgroundColor: phase.visibility === 'published' ? 'var(--p-success)' : 'var(--p-warning)' }}
/>
```

Scopul declarat e „pentru utilizatorii client, statusul de vizibilitate `Public` este ascuns”. Dar
elementul se randează în continuare — doar tooltipul dispare. Clientul primește un punct verde fără
nicio semnificație (vede doar publicate, deci e mereu verde) lângă fiecare fază, imposibil de
interpretat și imposibil de interogat.

**Fix minim:**

```tsx
{canEdit && (
  <span title={…} className="w-2 h-2 rounded-full flex-shrink-0" style={{ … }} />
)}
```

**Verifică apoi vizual**, ca la #89: cu bulina scoasă, rândul fazei nu trebuie să rămână cu un
`gap` gol în flex. Captură Playwright cu un cont de client, la desktop și la 390×800.

---

## [x] 4.4 — `showPublishedStatus` nu acoperă cazul draft; se sprijină pe o filtrare din altă parte

**Unde:** `components/PublishStatusControl.tsx:48`

```tsx
if (!canPublish && !isDraft && !showPublishedStatus) return null
```

Ascunde eticheta doar pentru `published`. Pentru un element **draft** cu `canPublish=false` și
`showPublishedStatus=false` — exact combinația pasată clientului la
`components/DocumentRequests.tsx:1262` — controlul cade pe ramura următoare și randează
„În pregătire” **clientului**.

Azi nu se vede, pentru că API-ul filtrează draft-urile pentru client
(`app/api/projects/[id]/document-requests/route.ts:83-85`, `rows = … .filter(isClientVisibleDocument)`).
Deci e o dependență tăcută între o componentă de UI și un filtru de pe server, la trei fișiere distanță.

**Fix minim:** fă condiția să însemne ce spune numele propului:

```tsx
if (!canPublish && !showPublishedStatus) return null
```

Un utilizator care nu poate publica și pentru care nu vrem statusuri de publicare nu are ce vedea,
nici „Public”, nici „În pregătire”.

---

## [x] 4.6 — `audit:check` nu verifica nimic: ieșea mereu cu 1

**Unde:** `scripts/check-audit-contract.mjs`

Constatare găsită **rulând** scriptul, nu citindu-l — la primul review i-am citit doar codul.

```
audit:check — information_schema.columns ... : PGRST106 Invalid schema: information_schema
audit:check — pg_indexes ...                 : PGRST106 Invalid schema: pg_catalog
audit:check — pg_namespace ...               : PGRST106 Invalid schema: pg_catalog
audit:check — pg_class ...                   : PGRST106 Invalid schema: pg_catalog
audit:check — pg_trigger ...                 : PGRST106 Invalid schema: pg_catalog
EXIT=1
```

PostgREST nu expune `information_schema` și `pg_catalog` pe proiectele Supabase. Cele cinci probe
structurale nu puteau reuși **niciodată**, fiecare chema `fail()`, iar scriptul nu ajungea niciodată
să scrie „contractul read-only este valid". Funcționa doar inventarul de action/entity types.

Descrierea PR-ului spune „Au fost adăugate verificări automate pentru contractul auditului". Pe
hârtie da; în practică, verificarea care există tocmai ca să confirme triggerul append-only nu-l
confirma. Un guardrail care iese mereu cu 1 e mai rău decât niciunul — îl ignoră toată lumea după a
doua rulare.

**Aplicat:** faptele vin dintr-un RPC `audit_logs_contract()` (coloane, indexuri, biții din `tgtype`
ai triggerului), `SECURITY DEFINER`, executabil doar de `service_role`. Regulile au ieșit în
`lib/audit-contract-checks.ts` ca să fie testabile fără Supabase.

**Cum a fost verificat:** Postgres 15 într-un container temporar, cu structura din producție și
ambele migrări aplicate. Acolo s-a confirmat și că triggerul lui tecs17 chiar funcționează —
`UPDATE` și `DELETE` refuzate cu `SQLSTATE 23001`, `INSERT` permis. Fixtura din teste e chiar
JSON-ul întors de funcție acolo, nu unul scris de mână. Containerul a fost șters după.

Un trigger prezent dar `AFTER`, sau doar pe `UPDATE`, sau dezactivat, e acum respins pe fiecare bit
în parte — o verificare de prezență l-ar fi trecut.

---

## [ ] 4.5 — PR-ul amestecă două subiecte fără legătură

39 de fișiere care conțin, la un loc, issue #90 (chat cu imagini și linkuri) **și** o serie de fix-uri
de audit — trigger append-only, ștergerea endpointului de delete, acțiunea `publish`, catalogul de
etichete, responsive pe pagina de audit. Ultimele n-au nimic de-a face cu chatul și au propriul
risc (o migrare deja aplicată manual în producție).

Asta contrazice regula pe care ai stabilit-o pentru voi: un singur PR per issue, pe `main`. În plus,
face review-ul mai greu decât suma părților și blochează livrarea auditului în spatele chatului.

**Ce aș face:** cere împărțirea în două PR-uri pe `main` — auditul separat, care e mic și gata de
merge, și chatul separat, cu 1.1–1.5 rezolvate. Dacă tecs17 preferă să nu mai umble la istoric,
măcar merge-ul auditului întâi, ca ce e gata să nu aștepte.

---

## Ce e OK — verificat în cod, nu presupus. Nu strica.

- **`lib/project-chat-links.ts:63-135` (`parseProjectChatHref`) e partea tare a PR-ului.** Acceptă
  exclusiv href-uri relative de formă canonică exactă: respinge `//`, `\`, orice non-ASCII, orice
  origine absolută, parametrii duplicați (`queryValues` întoarce `null`), combinațiile necunoscute
  de chei și hash-urile care nu se potrivesc cu activitatea. Am încercat să găsesc o cale de a
  strecura un link arbitrar și n-am găsit. Nu „simplifica” regexurile de acolo.
- **Mascarea eșuează închis.** `loadBatch` (`app/api/_utils/project-chat-links.ts:143-155`) întoarce
  zero rânduri la orice eroare, iar zero rânduri înseamnă „nimic nu e vizibil”, deci se maschează.
  Comentariul din cod o spune explicit. E alegerea corectă de prioritate.
- **Nicăieri `dangerouslySetInnerHTML`.** Corpurile de mesaj se randează prin segmente React
  (`splitProjectChatBody`), nu prin HTML injectat. Am căutat în tot diff-ul.
- **Uploadul nu se încrede în client pe partea de conținut.** După PUT, serverul recitește metadatele
  reale din storage cu `.info()` și verifică MIME-ul și coerența cu extensia
  (`app/api/projects/[id]/chat/messages/route.ts:78-96`). Path-ul e legat de `projectId` și de
  `userId`, iar `isCoherentProjectChatImageReference` verifică că numele declarat produce chiar
  sufixul din path — nu poți referi imaginea altui utilizator sau din alt proiect.
- **Ștergerea rutei `app/api/projects/[id]/activities/[activityId]/documents/route.ts` e câștigul
  ascuns al PR-ului.** Era un `DELETE` hard pe `project_activities` cu client de service, sub un path
  care sugera altceva, și un `PATCH` care scria `status` și `order_index` fără nicio validare. Am
  verificat că nu mai există nicio referință la ea sau la `/api/audit/[id]` în `app`, `components`,
  `lib`, `hooks`.
- **`audit_logs` append-only.** Triggerul e `BEFORE UPDATE OR DELETE FOR EACH ROW` și ridică
  `restrict_violation` (23001), plus `REVOKE UPDATE, DELETE … FROM anon, authenticated`. Constrângerea
  `CHECK` pe `action_type` fusese deja scoasă în `20260526000001`, deci valoarea nouă `publish` intră
  fără altă migrare — verificat, nu presupus.
- **Cheile de deep-link se potrivesc.** `handleChatNavigate` presetează `appliedDeepLink` /
  `handledDeepLink` cu `${phaseId}:${result.activityId}:${docId}`, iar efectele calculează
  `${targetPhaseId}:${targetActivityId}:${targetDocumentId}` din `searchParams`. Am verificat toate
  patru formele (fază, activitate, cerere din activitate, cerere generală), inclusiv coerciția lui
  `null` la `"null"` în template literal: se potrivesc în toate cazurile, deci nu există al doilea
  scroll parazit. E ușor de stricat la o refactorizare — nu atinge formatul cheii într-un singur loc.

---

# Anexă — cum reproduci verificările

**Terminațiile de linie (4.1):**

```bash
gh pr diff 96 > /tmp/pr96.diff
python3 - /tmp/pr96.diff <<'EOF'
import sys, collections
cur, c = None, collections.Counter()
for l in open(sys.argv[1], 'rb').read().split(b'\n'):
    if l.startswith(b'diff --git'): cur = l.split(b' b/')[-1].decode()
    elif l.startswith(b'-') and cur and l.endswith(b'\r'): c[cur] += 1
print(c.most_common())
EOF
```

**Opțiunile reale de `listV2` (1.4):**

```bash
sed -n '150,200p' node_modules/@supabase/storage-js/dist/index.d.cts
```

**Reînnoirea tokenului (1.1)** — în consola browserului, cu chatul deschis și composerul plin:

```js
await window.supabase?.auth.refreshSession()   // sau așteaptă expirarea naturală a JWT-ului
```

**Linkul rupt după ștergerea activității (1.2):**

1. Ca admin, pune în chat un link către o cerere dintr-o activitate (butonul „Inserează link intern”).
2. Verifică vizual că chip-ul apare corect.
3. Șterge activitatea din bara laterală și confirmă mutarea cererilor la „Cereri generale”.
4. Redeschide chatul — chip-ul devine „Element indisponibil”, deși cererea există.
