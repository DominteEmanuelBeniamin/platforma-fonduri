# PRD: Extinderea acoperirii jurnalului de audit

- **Product:** Bonie
- **Feature:** Audit Log Coverage Expansion
- **Status:** Draft for implementation
- **Date:** 2026-05-26
- **Author:** GaMa
- **Source ticket:** `audit incomplet — multe actiuni critice nu sunt loggate`

---

## 1. Decision Summary

| Decision | MVP contract |
|----------|--------------|
| Sursa de adevar | `audit_logs` este unicul registru pentru actiuni de business si securitate |
| Cobertura | Orice actiune `create/update/delete` pe entitati persistente si orice actiune sensibila (login, acces document, schimbare rol) produce o intrare |
| Helper | Un singur helper generic `logAction({ entityType, ... })` inlocuieste functiile per-entitate |
| UI | Filtrul de entitati si label-urile reflecta toate tipurile efectiv scrise in tabela |
| Retentie | Log-urile nu se sterg niciodata. Limita explicita doar pe dimensiunea payload-ului `old_values`/`new_values` |
| Acces fisiere | `action_type='download'` (tip nou, distinct de `'read'`) |
| Conversatii private | `update` fara preview, `delete` cu preview (forensic) |
| Error tracking | `console.error` structurat cu tag `[audit_log_failure]`; integrare Sentry — out of scope |

---

## 2. Problem

Jurnalul curent acopera doar o parte din actiunile sistemului:

- **Loggat:** users CRUD, projects CRUD, document-requests (CRUD + review + upload complete), chat messages pe proiect, login/logout, propagare template, stergere document din template.
- **Neloggat:** template-uri (CRUD complet pe templates/phases/activities/documents), statusuri, faze si activitati pe proiect, membri proiect (adaugare/scoatere/schimbare rol), clienti, conversatii private, descarcari de fisiere, remindere pe cereri, import template in proiect.

Consecinte:
- Nu putem reconstrui istoricul unui proiect, al unui template sau al unui acces la documente.
- Schimbarea rolurilor pe proiect (acces la date confidentiale) nu lasa urma.
- Descarcarile de documente sensibile nu pot fi auditate (problema GDPR / conformitate cu finantator).
- UI-ul din `/admin/audit` afiseaza entitati existente in DB (ex. `chat_message`) fara label/icon si nu le ofera in filtru.

---

## 3. Goal

Orice actiune relevanta din punct de vedere de business sau securitate produce o intrare in `audit_logs`, este filtrabila in UI-ul admin si poate fi exportata. Helper-ul de audit este unul singur, generic, si nu mai duplica cod la fiecare entitate noua.

---

## 4. Existing Product Context

- Helper: `app/api/_utils/audit.ts` — trei functii (`logUserAction`, `logProjectAction`, `logChatMessageAction`) + `getClientIP` / `getUserAgent`.
- Tabela: `audit_logs` cu coloane `user_id, action_type, entity_type, entity_id, entity_name, old_values, new_values, description, ip_address, user_agent, created_at`.
- UI: `app/admin/audit/page.tsx` — `ACTION_CONFIG` (5 actiuni) si `ENTITY_CONFIG` (5 entitati: user, project, document, phase, activity).
- Auth: login/logout sunt scrise direct de `app/api/auth/audit/route.ts`.

---

## 5. Scope

### 5.1 In Scope

#### 5.1.1 Helper generic

- Nou: `logAction({ actorId, actionType, entityType, entityId, entityName, oldValues?, newValues?, description, request })`.
- `request` extrage IP + UA intern, eliminand boilerplate-ul la call-site.
- Truncheaza `old_values` / `new_values` peste o limita (ex. 32 KB serializat) si pune un flag `_truncated: true`.
- Sanitizeaza campuri sensibile (parole, token-uri, semnaturi URL semnate) — lista explicita de chei excluse.
- Functiile vechi (`logUserAction`, `logProjectAction`, `logChatMessageAction`) devin wrappere subtiri sau sunt eliminate dupa migrare.

#### 5.1.2 Actiuni nou loggate

**Template-uri admin** (`entity_type: 'template' | 'template_phase' | 'template_activity' | 'template_document'`):
- `app/api/admin/templates/route.ts` — create.
- `app/api/admin/templates/[templateId]/route.ts` — update, delete.
- `app/api/admin/templates/[templateId]/duplicate/route.ts` — create (cu referinta la sursa).
- `app/api/admin/templates/phases/route.ts` + `[phaseId]/route.ts` — CRUD pe faze.
- `app/api/admin/templates/activities/route.ts` + `[activityId]/route.ts` — CRUD pe activitati.
- `app/api/admin/templates/documents/route.ts` — create (delete deja loggat in `[documentId]/route.ts`).

**Statusuri** (`entity_type: 'status'`):
- `app/api/admin/statuses/route.ts`, `[statusId]/route.ts`, `reorder/route.ts`.

**Structura proiect** (`entity_type: 'project_phase' | 'project_activity'`):
- `app/api/projects/[id]/phases/route.ts` + `[phaseId]/route.ts`.
- `app/api/projects/[id]/phases/[phaseId]/activities/route.ts` + `[activityId]/route.ts`.
- `app/api/projects/[id]/import-template/route.ts` — log de tip `create` pe proiect cu referinta la template-ul importat si numarul de entitati create.

**Membri proiect** (`entity_type: 'project_member'`, **prioritate maxima** — control acces):
- `app/api/projects/[id]/members/route.ts` — adaugare.
- `app/api/projects/[id]/members/[memberId]/route.ts` — schimbare rol, scoatere.
- `old_values` / `new_values` includ `role` si `user_id` afectat.

**Clienti** (`entity_type: 'client'`):
- `app/api/clients/route.ts` — create, update, delete.

**Conversatii private** (`entity_type: 'private_conversation' | 'private_message'`):
- Creare conversatie, trimitere mesaj, edit/delete mesaj (echivalentul chat-ului pe proiect).

**Acces la fisiere** (`entity_type: 'file_access'`):
- `app/api/files/[fileId]/signed-download/route.ts` — log de tip `read` (extensie la enum).
- `app/api/document-requests/[requestId]/attachment/signed-download/route.ts` — idem.
- `app/api/files/bulk-archive/route.ts` — log de tip `read` cu lista de file_ids (sau count + project_id).

**Cereri documente — completari:**
- `app/api/document-requests/[requestId]/reminder/route.ts` — log de tip `update` cu actiunea „reminder trimis".

#### 5.1.3 Extindere tipuri

- `action_type` si `entity_type` raman `text` in DB (confirmat din schema) — nu necesita migratie pentru tipuri noi.
- `action_type` capata `'download'` (tip nou, distinct) pentru accesari de fisiere prin signed URL.
- Tipurile noi de entitate sunt introduse direct din cod fara constrangere CHECK.

#### 5.1.4 UI admin (`app/admin/audit/page.tsx`)

- `ENTITY_CONFIG` capata toate tipurile noi (label RO + icon).
- `ACTION_CONFIG` capata `download` cu label si icon.
- Dropdown-ul „Toate entitatile" listeaza toate tipurile.
- Filtru nou „Utilizator" (cine a executat actiunea) — autocomplete pe profiles.
- Buton **Export CSV** pentru rezultatul filtrat curent.
- Link „Vezi istoric" pe fiecare entitate din log → preincarca filtrul cu `entity_id`.

#### 5.1.5 Retentie si performanta DB

- **Log-urile nu se sterg niciodata si nu se arhiveaza** — `audit_logs` creste la infinit. Decizie explicita pentru conformitate cu cerintele finantatorilor (POR/POIDS/PNRR), unde trasabilitatea poate fi ceruta la 5–10 ani dupa actiune.
- **Nu introducem cron / pg_cron / tabela de arhiva** in MVP.
- Pentru a sustine performanta filtrelor si a view-ului „istoric entitate", adaugam 4 indexuri:
  - `idx_audit_logs_entity` pe `(entity_type, entity_id)` — pentru istoricul unei entitati.
  - `idx_audit_logs_user_created` pe `(user_id, created_at DESC)` — pentru filtrul „cine a facut".
  - `idx_audit_logs_action_created` pe `(action_type, created_at DESC)` — pentru filtrul pe tip de actiune.
  - `idx_audit_logs_created` pe `(created_at DESC)` — pentru paginarea default.
- Limita de dimensiune **la nivel de aplicatie** (helper): payload-uri serializate peste 32 KB sunt trunchiate cu flag `_truncated: true`. JSONB-ul ramane fara CHECK constraint.

### 5.2 Out of Scope

- Audit pe view-uri / read general (afisare lista proiecte, deschidere modal etc.). Logam doar accesul la **continut sensibil** (descarcari de fisiere).
- Notificari in timp real catre admin pe baza log-urilor.
- Stergerea automata sau arhivarea log-urilor vechi (decizie: nu se sterg niciodata).
- Tabela `audit_logs_archive` + cron pg_cron (nu sunt necesare).
- Export catre SIEM extern.
- Integrare Sentry / Datadog pentru raportarea esuarilor de scriere (folosim `console.error` structurat).

---

## 6. Acceptance Criteria

1. Un admin care sterge un template vede o intrare in `/admin/audit` cu `entity_type='template'`, `action_type='delete'`, descriere care contine numele template-ului si `old_values` cu snapshot-ul.
2. Adaugarea/scoaterea unui membru pe proiect produce o intrare cu `entity_type='project_member'`, `entity_id` = id-ul membru-ului, si `new_values.role` / `old_values.role`.
3. O descarcare de fisier (signed download) produce o intrare cu `action_type='download'` si `entity_type='file_access'`, cu `entity_id` = file_id.
4. Filtrul de entitati din UI listeaza toate tipurile efectiv prezente in DB (validat prin `select distinct entity_type from audit_logs`).
5. Export CSV genereaza un fisier cu toate coloanele relevante pentru rezultatul filtrat curent.
6. Payload-urile `old_values` / `new_values` mai mari decat limita sunt salvate trunchiate cu flag `_truncated: true`, nu esueaza request-ul.
7. Helper-ul nou este folosit in toate call-site-urile noi; cele vechi pot fi migrate gradual sau intr-un PR separat.
8. Pentru fiecare endpoint din 5.1.2 exista cel putin un test (manual sau automat) care confirma scrierea log-ului.

---

## 7. Implementation Notes

### 7.1 Ordine sugerata de PR-uri

1. **PR 1 — Helper generic + sanitizare/trunchiere.** Nu schimba comportamentul; doar adauga `logAction` si pregateste terenul.
2. **PR 2 — Membri proiect + clienti.** Risc minim, valoare mare (control acces).
3. **PR 3 — Template-uri (toate sub-entitatile).**
4. **PR 4 — Statusuri + structura proiect (phases/activities/import).**
5. **PR 5 — Conversatii private.**
6. **PR 6 — Acces fisiere (`download`).** Logam emiterea de signed URL.
7. **PR 7 — UI: ENTITY_CONFIG complet, filtru user, export CSV, link istoric entitate.**
8. **PR 8 — Migratie Supabase cu cele 4 indexuri.** Poate fi facut si primul, e independent.

### 7.2 Cheile sanitizate implicit

`password`, `password_hash`, `token`, `access_token`, `refresh_token`, `signed_url`, `signature`, `secret`, `api_key`. Lista vine din helper, nu din call-site.

### 7.3 IP / proxy

Helper-ul citeste in ordine: `cf-connecting-ip`, `x-real-ip`, primul element din `x-forwarded-for`, fallback `'unknown'`.

### 7.4 Erori

Esuarea scrierii in `audit_logs` nu trebuie sa rupa request-ul utilizatorului — comportamentul curent (try/catch + `console.error`) se pastreaza. Mesajul devine structurat ca sa fie cautabil in Vercel logs si pregatit pentru o integrare ulterioara cu Sentry:

```ts
console.error('[audit_log_failure]', { entityType, entityId, error: error.message })
```

### 7.5 Actiuni fara entitate unica

`entity_id` este `uuid NULLABLE` in DB. Asta acopera cazurile:

- **`status_reorder`** — `entity_id = NULL`, `entity_type='status_reorder'`, snapshot in `new_values.order`.
- **`bulk-archive`** de fisiere — scriem **N intrari**, una per fisier (`entity_id` = file_id), nu o singura intrare pentru tot batch-ul. Mai zgomotos, dar auditorul cauta dupa fisierul X, nu dupa batch.
- **Login / logout** — `entity_id = user_id` (deja in `app/api/auth/audit/route.ts`).

---

## 8. Open Questions

Toate intrebarile deschise au fost rezolvate:

- ~~`read` vs `download`?~~ → **`download`** (Decision Summary).
- ~~Preview pentru mesaje private?~~ → **doar la `delete`** (Decision Summary).
- ~~Politica de retentie?~~ → **fara stergere, fara arhiva** (5.1.5).
- ~~Locatie arhiva?~~ → nu se aplica (fara arhiva).
- ~~Sentry sau echivalent?~~ → `console.error` structurat, integrare ulterioara out of scope (7.4).
