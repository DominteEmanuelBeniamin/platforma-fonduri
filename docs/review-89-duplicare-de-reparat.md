# Issue #89 — duplicare faze/activități: constatări din review și ce e de reparat

**Branch:** `feature/89-duplicare-faze-activitati` (7 commit-uri față de `origin/main`)
**Data review-ului:** 2026-09-02
**Cum a fost verificat:** diff complet `git diff origin/main...HEAD`, schema citită din DB-ul live
(nu din fișierele de tipuri, care mint), `tests/e2e/duplicare.spec.ts` rulat (2 trecute,
2 sărite fără `E2E_WRITES=1`), plus teste Playwright temporare de măsurare vizuală
peste `npm run dev` (șterse după).

**Stare: aplicat integral, în afară de 4.4** (butoanele „Duplică” din editorul de
șabloane, lăsate deliberat — vezi nota de acolo).

Cum a fost verificat după aplicare: `npx tsc --noEmit`, `npx eslint app components lib`
și `npm test` (150 de teste) trec curat; `npm run smoke:duplicare` — 35/35;
`E2E_WRITES=1 npx playwright test tests/e2e/duplicare.spec.ts` — 4/4. În plus, măsurători
Playwright temporare peste `npm run dev` pentru 1.1, 2.1, 2.2, 2.3 și 2.5, fiecare pusă
la încercare și pe codul de dinaintea reparației, plus un test de compensare pentru 1.3 cu
eșec injectat în insertul de cereri (șterse toate după verificare).

---

## Cum se lucrează pe fișierul ăsta

Ordinea e deja cea corectă: bug-uri de corectitudine → UX care blochează userul →
eficiență → cosmetic. Ia-le în ordine, bifează pe măsură ce le rezolvi.

Înainte să începi:

```bash
git fetch origin main
git log --oneline origin/main..HEAD          # trebuie să vezi cele 7 commit-uri
npm run dev                                   # pentru verificările vizuale
```

La final, pentru verificare:

```bash
npx tsc --noEmit
npx eslint app components lib
npx playwright test tests/e2e/duplicare.spec.ts
```

Fișierele centrale ale feature-ului:

| Fișier | Rol |
|---|---|
| `app/api/_utils/duplicate-project-items.ts` | inima duplicării pe server |
| `app/api/_utils/attachment-storage.ts` | copierea obiectelor din storage |
| `app/api/projects/[id]/phases/[phaseId]/duplicate/route.ts` | ruta de fază |
| `app/api/projects/[id]/phases/[phaseId]/activities/[activityId]/duplicate/route.ts` | ruta de activitate |
| `components/RowActionsMenu.tsx` | meniul „⋯” (nou) |
| `components/InlineInput.tsx` | câmpul de redenumire (extras din sidebar) |
| `components/ProjectPhasesSidebar.tsx` | bara laterală |
| `app/projects/[id]/page.tsx` | panoul central |
| `lib/duplicate-name.ts`, `lib/deletion-impact.ts` | utilitare noi |

---

# 1. Bug-uri de corectitudine

## [x] 1.1 — Duplicarea din sidebar lasă panoul central cu cererile de documente vechi

**Unde:** `components/ProjectPhasesSidebar.tsx:192`, `:228`, `:249`

```ts
// linia 192
const softRefresh = () => (onReorderRefresh ?? onRefresh)()
```

`onReorderRefresh` primește `refreshPhases` (`app/projects/[id]/page.tsx:1067`), care
actualizează **doar** `phases` (`app/projects/[id]/page.tsx:413-419`) — nu și
`allDocRequests`.

**Input → rezultat greșit:**
Duplici din bara laterală o activitate care are 3 cereri de documente. Toast-ul spune
„Activitatea a fost duplicată”. În panoul central copia afișează **„0 cereri”**
(`app/projects/[id]/page.tsx:1268`) și, extinsă, apare goală
(`app/projects/[id]/page.tsx:1328`), deși serverul chiar a creat cele 3 cereri.
Rămâne așa până la reload complet al paginii.

**Efect secundar pe același drum:** `documentRequests` stale înseamnă că
`activityDeletionImpact` (`lib/deletion-impact.ts:23`) raportează `moved: 0` pentru copie,
deci dialogul de ștergere al copiei **omite** avertismentul că cererile se mută la
„Cereri generale”. Userul șterge crezând că nu pierde nimic.

**De ce nu e la fel în panoul central:** acolo `handleDuplicatePhase` /
`handleDuplicateActivity` fac corect `Promise.all([refreshPhases(), refreshDocs()])`
(`app/projects/[id]/page.tsx:368`, `:389`). Doar sidebar-ul e pe jumătate.

**Fix minim:**

În `app/projects/[id]/page.tsx` există deja `refreshContent` la linia 484:

```ts
const refreshContent = async () => { await Promise.all([refreshPhases(), refreshDocs()]) }
```

1. Adaugă un prop nou la `ProjectPhasesSidebarProps`:
   ```ts
   /** Faze + cereri, fără spinner — după duplicare, unde apar cereri noi. */
   onDuplicateRefresh?: () => Promise<void> | void
   ```
2. Pasează-l din `app/projects/[id]/page.tsx:1067` (lângă `onReorderRefresh`):
   ```tsx
   onDuplicateRefresh={refreshContent}
   ```
3. În sidebar, folosește-l în cele două handlere de duplicare (liniile 228 și 249),
   în locul lui `softRefresh()`:
   ```ts
   await (onDuplicateRefresh ?? softRefresh)()
   ```

**NU** schimba `onReorderRefresh` să includă `refreshDocs` — reordonarea n-are nevoie și
ar face-o mai lentă degeaba.

**⚠️ Regulă de respectat (context din proiect):** refresh-ul trebuie să rămână „moale”.
`onRefresh` este `fetchAll`, care trece pagina prin spinnerul de `loading`
(`app/projects/[id]/page.tsx:888`) și **remontează sidebar-ul**, ceea ce ar închide pe loc
câmpul de redenumire în care intră copia. `refreshContent` nu face asta — e corect.

**Verificare:** duplică o activitate cu cereri **din bara laterală**, apoi uită-te în
panoul central fără să dai reload: trebuie să scrie numărul real de cereri, nu „0 cereri”.

---

## [x] 1.2 — Copia poate ajunge să împartă obiectul din storage cu originalul

**Unde:** `app/api/_utils/attachment-storage.ts:38-49` și
`app/api/_utils/duplicate-project-items.ts:105-110`

```ts
// attachment-storage.ts
export async function copyStorageObject(admin, fromPath, toPath): Promise<string | null> {
  const { error } = await admin.storage.from(ATTACHMENT_BUCKET).copy(fromPath, toPath)
  if (error) {
    console.error('copyStorageObject error:', { fromPath, toPath, error: error.message })
    return null                                    // ← orice eroare devine null
  }
  return toPath
}
```

```ts
// duplicate-project-items.ts:105-110
const copiedPath = await copyStorageObject(admin, attachment.storage_path, projectAttachmentPath(...))
return { ...attachment, storage_path: copiedPath ?? attachment.storage_path, copied: copiedPath !== null }
//                                                  ^^^^^^^^^^^^^^^^^^^^^^^ calea ORIGINALULUI
```

**De ce e o problemă:** comentariul justifică fallback-ul prin „sursa nu mai există”, dar
`null` acoperă și 5xx tranzitoriu, timeout, quota depășită, coliziune de nume. În acele
cazuri copia primește `storage_path`-ul **originalului** — exact situația pe care
`attachment-storage.ts:3-5` o declară inacceptabilă:

> „O copie trebuie să-și aibă propriul obiect, nu să arate spre al originalului: altfel
> ștergerea modelului de pe unul îl rupe pe celălalt.”

**Input → rezultat greșit:** duplici o fază în timpul unui hiccup de rețea spre storage →
copia și originalul arată spre același obiect → cineva șterge fișierul-model de pe
original → fișierul copiei devine un link mort. Și nimic nu semnalează problema:
`attachment_missing_at` se copiază de la sursă, deci rămâne `null`.

**Fix minim:**

1. În `attachment-storage.ts`, întoarce și motivul, nu doar `null`:
   ```ts
   export type CopyResult =
     | { path: string }
     | { path: null; reason: 'missing' | 'failed' }

   export async function copyStorageObject(admin, fromPath, toPath): Promise<CopyResult> {
     const { error } = await admin.storage.from(ATTACHMENT_BUCKET).copy(fromPath, toPath)
     if (!error) return { path: toPath }
     console.error('copyStorageObject error:', { fromPath, toPath, error: error.message })
     // Supabase Storage întoarce 404 / "not found" când obiectul sursă lipsește.
     const missing = /not found|404/i.test(error.message)
     return { path: null, reason: missing ? 'missing' : 'failed' }
   }
   ```
2. În `duplicate-project-items.ts:105-110`:
   - `reason === 'missing'` → păstrează calea veche **și** setează pe copie
     `missing_at: attachment.missing_at ?? now` și `missing_checked_at: now`, ca marcajul
     de fișier lipsă să fie vizibil;
   - `reason === 'failed'` → **aruncă** eroarea (intră în compensarea de la 1.3, mai jos).
3. Actualizează și cel de-al doilea apelant:
   `app/api/admin/templates/[templateId]/duplicate/route.ts:129-140`
   (acolo se folosesc `copiedPath ?? attachment.storage_path` și expresia `legacyPath`).
   Aceeași regulă: „missing” se tolerează, restul aruncă.

**Verificare:** greu de testat automat. Minim: `npx tsc --noEmit` + un test unitar pe
funcția de clasificare a mesajului de eroare.

---

## [x] 1.3 — Fără atomicitate: un eșec la jumătate lasă o copie parțială vizibilă

**Unde:** `app/api/_utils/duplicate-project-items.ts:218-275` (`duplicatePhase`)

Ordinea operațiilor, fără tranzacție și fără compensare:

```
shiftOrderAfter(faze)   → mută frații          (linia 232)
insert project_phases   → creează copia        (linia 234)
for (activități)        → insert per activitate (linia 262)
  for (cereri)          → insert per cerere     (linia 101)
    copyStorageObject   → copie per fișier      (linia 105)
```

**Input → rezultat greșit:** fază cu 8 activități; pică la a 5-a (rețea, RLS, storage).
Ruta întoarce 500. Clientul afișează „Nu am putut duplica faza. Reîncearcă.” Dar în
proiect **rămâne** o fază-copie cu 4 activități, care apare la următorul refresh. Userul
reîncearcă → a doua copie parțială, numită „X (copie 2)”. În plus, `shiftOrderAfter` a
deplasat deja `order_index`-ul fraților, lăsând o gaură în ordine.

**Fix minim (fără RPC):** compensare explicită în `duplicatePhase`. Nu există RPC de SQL
generic în proiect (verificat: `exec_sql` întoarce 404), iar restul repo-ului
(`import-template`) merge pe aceeași abordare non-tranzacțională — deci compensarea e
fixul proporțional, nu o rescriere în plpgsql.

```ts
export async function duplicatePhase(admin, options) {
  const copiedPaths: string[] = []           // căile create în storage, pentru curățare
  let createdPhaseId: string | null = null

  try {
    // ... codul existent, cu push în copiedPaths pentru fiecare copiere reușită
    //     și createdPhaseId = phase.id imediat după insert
  } catch (error) {
    // Compensare: ștergem în ordinea inversă a dependențelor.
    if (createdPhaseId) {
      const { data: acts } = await admin
        .from('project_activities').select('id').eq('phase_id', createdPhaseId)
      const actIds = (acts ?? []).map(a => a.id)
      if (actIds.length) {
        const { data: reqs } = await admin
          .from('document_requirements').select('id').in('activity_id', actIds)
        const reqIds = (reqs ?? []).map(r => r.id)
        if (reqIds.length) {
          await admin.from('document_requirement_attachments').delete().in('document_requirement_id', reqIds)
          await admin.from('document_requirements').delete().in('id', reqIds)
        }
        await admin.from('project_activities').delete().in('id', actIds)
      }
      await admin.from('project_phases').delete().eq('id', createdPhaseId)
    }
    if (copiedPaths.length) await admin.storage.from(ATTACHMENT_BUCKET).remove(copiedPaths)
    // ordinea fraților: readu-i, dacă shiftOrderAfter a apucat să ruleze
    throw error
  }
}
```

Pentru readucerea ordinii, cel mai simplu e să faci `shiftOrderAfter` **după** ce copia a
fost inserată complet (inserezi copia cu `order_index = sourceOrderIndex + 1`, apoi muți
frații) — atunci un eșec în mijlocul copierii nu mai atinge deloc frații și n-ai ce
compensa acolo.

**Același tratament** pentru ruta de activitate
(`app/api/projects/[id]/phases/[phaseId]/activities/[activityId]/duplicate/route.ts:63-72`),
unde `shiftActivitiesAfter` rulează înaintea lui `duplicateActivity`.

**Verificare:** rulează `scripts/smoke-duplicare.mjs`, apoi simulează un eșec (de exemplu
comentează temporar un câmp obligatoriu la insertul de cereri) și confirmă că în DB nu
rămâne nicio fază orfană.

---

## [x] 1.4 — Motivul real al serverului nu ajunge niciodată la user

**Unde (server):**
- `app/api/projects/[id]/phases/[phaseId]/duplicate/route.ts:30` și `:87`
- `app/api/projects/[id]/phases/[phaseId]/activities/[activityId]/duplicate/route.ts:29` și `:102`

**Unde (client):**
- `components/ProjectPhasesSidebar.tsx:232`, `:235`, `:253`, `:256`
- `app/projects/[id]/page.tsx:365`, `:374`, `:386`, `:392`

**De ce e o problemă:** `apiFetch` **rescrie** câmpul `error` cu un text generic pe orice
răspuns non-ok (`app/providers/AuthProvider.tsx:69-82`):

```ts
if (body && typeof body === 'object' && 'error' in body) {
  return { ...body, error: userErrorMessage(response.status, 'Nu am putut finaliza acțiunea.') }
}
```

Convenția stabilită în #70 este ca motivul real să vină pe câmpul **`message`** — vezi
`lib/client-upload.ts:110-114`:

```ts
/** `apiFetch` rescrie `error`; motivul real al serverului vine în `message`. */
async function failureMessage(res: Response, fallback: string) {
  const body = await res.json().catch(() => null)
  return (typeof body?.message === 'string' && body.message) || fallback
}
```

Rutele de duplicare trimit doar `{ error }`, iar **niciunul** din cei 4 handleri client nu
citește body-ul răspunsului.

**Input → rezultat greșit:** un consultant fără drept apasă „Duplică”. Serverul întoarce
403 cu „Nu ai permisiunea să duplici faze”. Userul citește „Nu am putut duplica faza.
Reîncearcă.” și reîncearcă la nesfârșit, fără să afle vreodată că e o problemă de drepturi.

**Fix minim:**

1. În ambele rute de duplicare, adaugă `message` lângă `error` la fiecare
   `NextResponse.json` de eroare (4 locuri în total):
   ```ts
   return NextResponse.json(
     { error: 'Nu ai permisiunea să duplici faze', message: 'Nu ai permisiunea să duplici faze' },
     { status: 403 },
   )
   ```
   ```ts
   return NextResponse.json({ error: error.message, message: error.message }, { status: 500 })
   ```
   Păstrează și `error` — restul aplicației se bazează pe el.
2. În client, citește `message`. Poți reutiliza tiparul din `lib/client-upload.ts`:
   ```ts
   const body = await res.json().catch(() => null)
   showToast(
     (typeof body?.message === 'string' && body.message) || 'Nu am putut duplica faza. Reîncearcă.',
     'error',
   )
   ```
   Aplică-l în toate cele 4 locuri (2 în sidebar, 2 în panoul central).

**Verificare:** loghează-te cu un cont fără drept de editare pe proiect și apasă
„Duplică” — toast-ul trebuie să spună „Nu ai permisiunea…”, nu textul generic.

---

# 2. UX care blochează userul

## [x] 2.1 — Pe telefon nu poți duplica nimic din bara laterală

**Unde:** `components/ProjectPhasesSidebar.tsx:498` (fază) și `:599` (activitate)

```tsx
className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 data-[open=true]:opacity-100 transition-opacity"
```

**Măsurat cu Playwright la 390×800**, în drawer-ul de faze: **toate** cele 6 butoane „⋯”
au `opacity: 0`. `group-hover` nu se declanșează niciodată pe touch. În panoul central
aceleași butoane au `opacity: 1` și meniul se deschide corect.

Pattern-ul e preexistent (îl avea și butonul de ștergere), dar branch-ul mută *singura*
cale spre Redenumește / Duplică / Șterge sub el. **Userii lucrează și de pe telefon.**

Asta e și inconsistența de affordance dintre sidebar și panoul central: același meniu,
aceiași itemi, în aceeași ordine — dar într-un loc mereu vizibil, în celălalt doar la hover.

**Fix minim:** pe ambele linii (498 și 599), fă ascunderea condiționată de desktop:

```tsx
className="opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-within:opacity-100 data-[open=true]:opacity-100 transition-opacity"
```

(la linia 599, `group-hover/act` în loc de `group-hover`)

Alternativa, dacă vrei o singură convenție peste tot: scoate ascunderea complet — panoul
central deja n-o are, și acolo nu deranjează.

**Verificare vizuală:**
```ts
await page.setViewportSize({ width: 390, height: 800 })
// login, deschide /projects/<id>, tab „Fazele proiectului”, apoi drawer-ul de faze
const opac = await page.evaluate(() =>
  [...document.querySelectorAll('[aria-label^="Acțiuni pentru"]')]
    .map(b => getComputedStyle(b.parentElement!).opacity))
// toate trebuie să fie "1"
```

---

## [x] 2.2 — Meniul „⋯” e inaccesibil de la tastatură

**Unde:** `components/RowActionsMenu.tsx:62-140`

**Măsurat pe pagina reală:** focus pe trigger → `Enter` deschide meniul, dar focusul rămâne
pe buton; `ArrowDown` nu face nimic; **`Tab` sare la „Extinde faza”, iar meniul rămâne
deschis** în `body`. Un user pe tastatură deschide meniul și nu ajunge niciodată la itemi.

Nu există roving tabindex, focus trap, sau închidere la pierderea focusului. Lista e în
portal, la finalul lui `body`, deci ordinea de tabulare n-o atinge natural.

**Ce funcționează deja (verificat, nu strica):**
- `aria-haspopup="menu"`, `aria-expanded`, `role="menu"` / `role="menuitem"` — corecte
- `Escape` închide meniul, iar focusul rămâne pe trigger (măsurat: după `Escape` curat,
  `document.activeElement` **este** trigger-ul)
- click în afară închide
- repoziționare la scroll: măsurat, meniul urmărește trigger-ul (y 295 → 177 la scroll de
  400px), inclusiv în containere interne (listener cu `capture: true`)
- fondul e opac: `rgb(255, 255, 255)`; `.project-scope` pe portal chiar aduce token-urile
  `--p-*` — **nu scoate clasa `project-scope` de pe div-ul din portal** (linia 120), altfel
  fondul devine transparent

**Fix minim** în `components/RowActionsMenu.tsx`:

1. La deschidere, mută focusul pe primul item:
   ```ts
   useEffect(() => {
     if (!open) return
     menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
   }, [open])
   ```
2. În `onKeyDown` (linia 70), adaugă navigarea și închiderea la `Tab`:
   ```ts
   const onKeyDown = (event: KeyboardEvent) => {
     if (event.key === 'Escape') { setOpen(false); buttonRef.current?.focus(); return }
     if (event.key === 'Tab') { setOpen(false); return }
     if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
     event.preventDefault()
     const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
     if (items.length === 0) return
     const at = items.indexOf(document.activeElement as HTMLButtonElement)
     const next = event.key === 'ArrowDown'
       ? (at + 1) % items.length
       : (at - 1 + items.length) % items.length
     items[next].focus()
   }
   ```

**Verificare:** `Tab` până pe „⋯”, `Enter`, `ArrowDown` ×2, `Enter` — trebuie să
declanșeze acțiunea a doua. `Escape` trebuie să întoarcă focusul pe „⋯”.

---

## [x] 2.3 — Redenumirea în sidebar e ilizibilă pe nume lungi

**Unde:** `components/ProjectPhasesSidebar.tsx:466-476` (fază) și `:560-570` (activitate),
cu `components/InlineInput.tsx`

**Măsurat:** câmpul are **131 px** lățime. Pentru faza „Modificări contractuale (contract
de finantare, dacă e cazul)” se vede doar coada: `antare, dacă e cazul)`. Nu vezi ce
redenumești. În panoul central același `InlineInput` are ~615 px și arată bine — încă o
inconsistență între cele două suprafețe pentru aceeași operație.

**Cauza:** `InlineInput` stă în `flex-1 min-w-0` alături de bulina de status, chevron-ul de
colapsare și indentare, într-o coloană de 288 px; cele două butoane ✓/✗ mai iau ~50 px.

**Fix minim (alege unul):**
- **A (recomandat):** cât ține redenumirea, dă rândului lățime totală — ascunde bulina și
  `Collapsible.Trigger` (chevron-ul) cât timp `renamingId === phase.id`. Sunt oricum
  inutile în starea aia.
- **B:** ascunde butonul ✓ din `InlineInput` în varianta `sm` (Enter confirmă oricum,
  Escape anulează) — recuperezi ~26 px, dar tot rămâne strâmt.
- **C:** lasă câmpul, dar adaugă `title={phase.name}` pe input, ca măcar hover-ul să arate
  numele complet. Cel mai slab dintre cele trei.

**Aplicat: A**, extins la mânerul de tragere și la butonul de calendar al activității —
în redenumire rândul e doar al câmpului. În plus, `InlineInput` intră cu numele *selectat
și derulat la început* (`setSelectionRange(…, 'backward')` + `scrollLeft = 0`): `autoFocus`
singur lăsa cursorul la coadă, deci tot coada se vedea. Și `title` (varianta C) pe input.

**Verificat:** captură Playwright pe „Modificări contractuale…” și „Deschidere cont
distinct bancă parteneră”, în redenumire din sidebar: câmpul a crescut de la **131 px la
199 px**, iar începutul numelui e vizibil.

---

## [x] 2.4 — Userul nu află ce s-a copiat

**Unde:** `components/ProjectPhasesSidebar.tsx:231`, `:252` și
`app/projects/[id]/page.tsx:372`, `:390`

Toast-ul actual: „Faza „X” a fost duplicată. Copia este în pregătire.”

Serverul întoarce deja numerele și **nimeni nu le folosește**
(`app/api/projects/[id]/phases/[phaseId]/duplicate/route.ts:81-84`):

```ts
return NextResponse.json({
  phase,
  activities_created: counts.activities,
  document_requests_created: counts.documentRequests,
}, { status: 201 })
```

Ruta de activitate întoarce `document_requests_created` (`:98-101`).

Regula reală — „cererile și fișierele-model se copiază, fișierele urcate de client nu” —
nu apare **nicăieri** în UI, doar în comentariul din
`app/api/_utils/duplicate-project-items.ts:4-8`.

**Fix minim:** citește numerele din răspuns (le ai deja în `await res.json()`) și pune-le
în toast:

```ts
const { phase: copy, activities_created, document_requests_created } = await res.json()
showToast(
  `Faza „${phase.name}” a fost duplicată: ${activities_created} activități, ` +
  `${document_requests_created} cereri de documente. Fișierele încărcate de client nu se ` +
  `copiază. Copia este în pregătire.`,
  'success',
)
```

Analog pentru activitate, cu `document_requests_created`.

---

## [x] 2.5 — Target-uri de click sub prag

**Unde:** `components/RowActionsMenu.tsx:105` și `:88`

```tsx
className={`${size === 'sm' ? 'p-0.5' : 'p-1'} rounded ...`}
const iconSize = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4'
```

**Măsurat în pagină:**
- trigger fază (`md`): **24×24 px** — sidebar și panou central
- trigger activitate în sidebar (`size="sm"`, liniile 597 și 638 din sidebar): **16×16 px**

Pragul cerut e ≥32 px. 16 px e greu de nimerit chiar și cu mouse-ul, cu atât mai mult pe
telefon.

**Fix minim:** mărește padding-ul, păstrând iconița mică acolo unde e nevoie de compactare:

```tsx
className={`${size === 'sm' ? 'p-2' : 'p-2'} rounded ...`}   // 12+16=28 / 16+16=32
```

Sau, mai simplu: scoate varianta `sm` cu totul și folosește `md` peste tot (24 px icon-box
+ `p-1.5` → 28 px; cu `p-2` → 32 px). Verifică apoi că rândurile din sidebar nu se rup —
`RowActionsMenu` are `flex-shrink-0`, iar numele are `truncate`, deci ar trebui să încapă.

**Itemii din meniu** (`px-3 py-1.5 text-xs`, ~28 px înălțime) sunt la limită; dacă tot
umbli acolo, `py-2` îi duce la ~32 px.

**Aplicat:** padding-ul, nu scoaterea variantei `sm` — `sm` → `p-2.5` (12+20) și `md` →
`p-2` (16+16), amândouă **32 px**, cu iconița mică păstrată pe rândurile de activitate.
Itemii din meniu au trecut la `py-2` (~32 px), iar estimarea de înălțime din `place()` a
urmat, ca meniul să se așeze corect când nu mai încape jos.

**Verificat** cu fragmentul de mai jos, pe desktop și la 390×800: toate cele 11 butoane
„⋯” măsoară 32×32.

```ts
const boxes = await page.evaluate(() =>
  [...document.querySelectorAll('[aria-label^="Acțiuni pentru"]')]
    .map(b => { const r = b.getBoundingClientRect(); return { w: r.width, h: r.height } }))
// toate ≥ 32
```

---

## Ce e OK — verificat vizual, nu doar din citirea codului. Nu strica.

- Fondul meniului e opac: `rgb(255, 255, 255)`. `.project-scope` de pe div-ul din portal
  chiar aduce token-urile `--p-*` în `body`. **Nu scoate clasa aia.**
- „Ambele teme” nu se aplică: aplicația **nu are dark mode**. `app/globals.css:173`
  definește o singură paletă `--p-*`, iar în CSS nu există niciun `prefers-color-scheme`
  sau `[data-theme]`. Testul existent care verifică `rgb(255,255,255)` e corect așa.
- Meniul nu se taie de `overflow-hidden` al cardului — testul de `elementFromPoint` din
  `tests/e2e/duplicare.spec.ts:95-105` trece.
- Sidebar și panou central afișează **exact aceiași itemi, în aceeași ordine**:
  `["Redenumește", "Duplică"]` (+ „Șterge” la admin). Consistența de conținut e bună —
  problema e doar de vizibilitate (2.1) și de lățime la redenumire (2.3).
- Pe mobil, meniul din panoul central se așază corect în viewport (x 137→313 la 390 px).
- Copia intră direct în redenumire cu numele precompletat, iar `autoFocus` o aduce în ecran.
- Refresh-ul după duplicare e cel „moale” (`refreshPhases`), nu `fetchAll` — corect,
  `fetchAll` ar remonta sidebar-ul și ar închide câmpul de redenumire.
- Autorizarea e identică cu ruta de creare: `requireProjectAccess` + refuz pentru rolul
  `client`. Apartenența fazei la proiect e validată pe ambele rute. Codurile 201 / 403 /
  404 / 500 sunt corecte.
- `source_template_*_id: null` pe copii evită exact indexurile unice din
  `supabase/migrations/20260520000000_soft_delete_document_requests.sql:80-90`. Verificat
  și că propagarea din șabloane se face pe `source_template_document_requirement_id`
  (`app/api/admin/templates/[templateId]/propagation/apply/route.ts:186`), deci copiile
  sunt corect excluse din propagare.
- `assigned_at` **nu** e trimis către `project_activities` — coloana chiar nu există
  (confirmat pe DB-ul live). Corect.
- Cererile soft-deleted nu se copiază (`.is('deleted_at', null)`). `project_activities`
  n-are `deleted_at`, deci copierea tuturor activităților fazei e corectă.
- `InlineInput` a fost extras curat din sidebar — **nu a rămas niciun control vechi
  duplicat** nicăieri în repo (verificat).
- `npx tsc --noEmit` și `npx eslint` trec curat pe branch.

---

# 3. Eficiență

## [x] 3.1 — N+1 masiv la duplicarea unei faze

**Unde:** `app/api/_utils/duplicate-project-items.ts:262` (buclă activități) și `:101`
(buclă cereri)

Pentru fiecare activitate se face un INSERT separat, iar pentru fiecare cerere de documente
încă un INSERT separat. Fază cu 15 activități × 6 cereri ≈ **105 round-trip-uri
secvențiale** spre Supabase, plus copiile din storage. La ~60 ms latență → peste 6 secunde,
cu un buton care nu arată niciun progres.

**Fix minim:**
1. În `duplicateDocumentRequests`, un singur insert bulk pentru toate cererile activității:
   ```ts
   const { data: copies, error } = await admin
     .from('document_requirements')
     .insert(rows)           // rows = toate cererile, construite în prealabil
     .select('id')
   ```
   PostgREST întoarce rândurile în ordinea inserării, deci le poți împerechea cu `rows`
   după index. Apoi un singur insert bulk pentru toate atașamentele lor.
2. În `duplicatePhase:262`, `Promise.all` peste activități în loc de `for...of` secvențial
   — `order_index` e explicit, deci ordinea inserării nu contează.

**Atenție:** dacă faci 3.1 înainte de 1.3, compensarea de la 1.3 devine mai importantă, nu
mai puțin — cu inserturi paralele ai mai multe fire care pot pica.

## [x] 3.2 — `shiftOrderAfter`: un UPDATE per frate

**Unde:** `app/api/_utils/duplicate-project-items.ts:49-55`

```ts
for (const row of data ?? []) {
  await admin.from(table).update({ order_index: (row.order_index ?? 0) + 1 }).eq('id', row.id)
}
```

Proiect cu 12 faze → până la 11 UPDATE-uri secvențiale doar ca să faci loc copiei.

**Fix minim:** un RPC `shift_order_index(table, scope_column, scope_value, from_index)` care
face `update ... set order_index = order_index + 1 where ...` într-un singur statement.
Rezolvă și jumătate din problema de atomicitate de la 1.3.

Dacă nu vrei migrare nouă acum: măcar `Promise.all` peste update-uri — nu e atomic, dar
taie latența. (Ordinea descrescătoare există ca să rămână citibil în timpul operației; cu
`Promise.all` pierzi asta, dar nu există constraint unic pe `order_index`, deci nu strică
nimic.)

**Aplicat: `Promise.all`, fără migrare** — un RPC nou ar cere ca Sandu să ruleze o migrare
în SQL Editor pentru un câștig de latență, iar atomicitatea de care avea nevoie 1.3 vine
deja din mutarea shift-ului *după* copie plus compensare. `shiftOrderAfter` primește acum
și `exceptId`, ca să nu deplaseze chiar copia abia inserată.

## [x] 3.3 — `findReferencedPaths` rulează la fiecare creare de document în șabloane

**Unde:** `app/api/admin/templates/documents/route.ts:65`

Face 3 SELECT-uri `in(...)` chiar și pentru un upload nou-nouț, unde nu poate exista
partaj de cale. E pe drumul cald al editorului de șabloane.

**Fix minim:** trimite un flag din client (`from_duplicate: true`) când documentul vine
dintr-o duplicare locală, și sari peste verificare altfel. Sau, mai robust, marchează în
starea locală a editorului atașamentele clonate și trimite doar pentru ele.

**Aplicat: varianta robustă, fără flag nou** — serverul scoate din verificare doar căile
atașamentelor *fără* `id` de rând existent, adică exact fișierele abia încărcate (UUID
proaspăt din `templateAttachmentPath`, imposibil de partajat). Semnalul e în datele pe care
clientul le trimite oricum, deci nu se adaugă un câmp de încredere nou, iar implicit se
verifică — se sare doar pe ce e demonstrabil nou.

---

# 4. Cosmetic / cod duplicat introdus de branch

- [x] **`app/projects/[id]/page.tsx:1217`** — `<div className="flex items-center gap-2.5">`
  înfășoară **un singur** copil (`PublishStatusControl`). Wrapper fără efect, rămas din
  refactor. Șterge-l.

- [x] **`app/api/_utils/duplicate-project-items.ts:110`** — câmpul
  `copied: copiedPath !== null` e calculat și nefolosit nicăieri. (Dispare oricum la 1.2.)

- [x] **`app/api/_utils/duplicate-project-items.ts:19-26`** — `slugify` e o copie a
  slug-ului inline din `app/api/projects/[id]/phases/route.ts:88-93`. Extrage-l într-un
  `lib/slug.ts` unic și folosește-l din ambele locuri.

- [ ] **Lăsat deliberat** — **`app/admin/templates/page.tsx:1386` și `:1453`** — butoane „Duplică” ca iconițe
  separate, nu prin `RowActionsMenu`. E alt ecran, cu alt limbaj vizual (Tailwind
  `slate-*`/`indigo-*`, nu token-uri `--p-*`), deci e defensabil să rămână așa. Dacă vrei o
  singură convenție peste tot, aici e locul unde diverge.

- [x] **`app/api/projects/[id]/phases/[phaseId]/route.ts:80`** — PATCH-ul actualizează
  `name` fără să recalculeze `slug`. Branch-ul e primul care expune redenumirea în UI, deci
  de acum `slug`-ul rămâne stale („…-copie” după o redenumire).
  **Verificat: `slug`-ul de fază nu e citit nicăieri în codul aplicației azi** — apare doar
  în `revert_project_phase` din fișierele de tipuri generate (`lib/database.types.ts:1058`,
  `types/database.ts:1024`), care nu se apelează de nicăieri și n-are nici măcar migrare în
  `supabase/migrations/`. Deci e inofensiv acum, dar e o mină pentru mai târziu. Fix de o
  linie: recalculează slug-ul când se schimbă numele.

- [x] **`lib/duplicate-name.ts:19`** — duplicarea unei copii dă „X (copie) (copie)”, apoi
  „X (copie) (copie) (copie)”. Restul cazurilor limită sunt OK: diacriticele merg
  (comparație normalizată `trim().toLowerCase()`), numele lungi merg (coloana e `text`,
  fără limită), numele gol devine „Fără nume”. Dacă vrei, un regex care detectează sufixul
  existent ar da „X (copie 2)”:
  ```ts
  const match = base.match(/^(.*?)\s*\(copie(?:\s+\d+)?\)$/)
  const root = match ? match[1] : base
  ```

- [x] **`app/api/_utils/duplicate-project-items.ts:152`** — copiile păstrează
  `source_template_attachment_id` pe atașamente, deși cererea are
  `source_template_document_requirement_id: null`. Verificat că e inert (propagarea se face
  pe câmpul cererii, nu al atașamentului), dar e incoerent cu intenția declarată în
  comentariul de la linia 133-134. Pune-l pe `null`.

---

# Anexă — cum reproduci verificările vizuale

Fișierul de teste existent e `tests/e2e/duplicare.spec.ts`, cu helperi în
`tests/e2e/helpers/project-state.ts`. Rulează peste dev server pornit separat.

```bash
npm run dev                                          # terminal 1
npx playwright test tests/e2e/duplicare.spec.ts      # terminal 2
```

Testele care scriu în proiectul real sunt sărite fără `E2E_WRITES=1`; ele își fac singure
curat prin `snapshotProject` / `restoreProject`. Credențialele vin din `.env.e2e.local`,
cheia de service din `.env.local`.

Pentru măsurători ad-hoc (dimensiuni, opacitate, focus), tiparul folosit în review:

```ts
const info = await page.evaluate(() =>
  [...document.querySelectorAll('[aria-label^="Acțiuni pentru"]')].map(btn => {
    const r = btn.getBoundingClientRect()
    return {
      label: btn.getAttribute('aria-label'),
      w: Math.round(r.width), h: Math.round(r.height),
      opac: getComputedStyle(btn.parentElement!).opacity,
    }
  }))
console.log(JSON.stringify(info, null, 1))
```

Pentru schema din DB (fișierele de tipuri din repo mint — interoghează DB-ul live):

```js
const r = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`,
  { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } })
console.log(Object.keys((await r.json())[0]))
```
