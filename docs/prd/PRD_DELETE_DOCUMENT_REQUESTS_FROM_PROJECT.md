# PRD: Retragerea cererilor de documente dintr-un proiect

- **Product:** Bonie
- **Feature:** Project Document Request Retirement
- **Status:** Draft for implementation
- **Date:** 2026-05-21
- **Author:** GaMa
- **Source ticket:** `stergere la cereri de documente direct din pagina de proiect, nu doar din template`

---

## 1. Decision Summary

| Decision | MVP contract |
|----------|--------------|
| User action | Utilizatorul vede actiunea **Sterge din proiect** |
| Data behavior | Cererea este soft-deleted/retrasa, nu hard-deleted |
| Template impact | Niciunul; template-ul sursa nu este modificat |
| Existing uploads | Raman in DB si storage, dar uploadurile active sunt soft-deleted impreuna cu cererea |
| Allowed actors | Admin si consultant cu acces de scriere la proiect |
| Client behavior | Clientul nu vede cererea retrasa si nu poate actiona endpoint-ul |

Aceasta functie rezolva o exceptie locala de proiect. Nu este un mecanism de propagare inversa catre template.

---

## 2. Problem

O cerere de document copiata din template sau adaugata manual poate deveni nerelevanta intr-un proiect anume. Astazi ea ramane in tab-ul **Documente**, chiar daca adminul sau consultantul stie ca nu mai trebuie ceruta clientului.

Fara o actiune locala:

- lista proiectului contine cereri false;
- clientul poate incarca documente inutile;
- echipa este tentata sa modifice template-ul global pentru o exceptie locala.

---

## 3. Goal

Adminul sau consultantul retrage o cerere de document direct din pagina proiectului, cu efect imediat in fluxul activ si fara pierderea istoricului cererii.

---

## 4. Existing Product Context

- `components/DocumentRequests.tsx` afiseaza cererile unui proiect.
- `GET/POST /api/projects/[id]/document-requests` citeste si creeaza cereri per proiect.
- `PATCH /api/document-requests/[requestId]` actualizeaza deadline si asignare.
- Codul curent are delete pentru documentele din template, nu pentru `document_requirements` deja create in proiect.

---

## 5. Scope

### 5.1 In Scope

- Actiune de retragere pentru o singura cerere activa din pagina proiectului.
- Confirmare cu context suficient inainte de retragere.
- Filtrarea cererilor retrase din view-urile active ale proiectului si ale clientului.
- Audit entry pentru actiune.
- Blocarea actiunilor ulterioare de upload/review pe cererea retrasa.
- Soft delete pentru fisierele active deja incarcate pe cerere, fara hard delete din DB sau storage.

### 5.2 Out of Scope

- Stergere bulk.
- Hard delete din DB sau storage.
- Restore UI in acelasi release.
- Modificarea template-ului sursa.
- Retragerea automata a cererilor dupa modificari de template.

---

## 6. User Stories

| ID | As a... | I want to... | So that... |
|----|---------|--------------|------------|
| US-01 | Admin | Retrag o cerere gresita din proiect | Corectez proiectul fara efect global |
| US-02 | Consultant | Retrag o cerere care nu se aplica acelui client | Clientul lucreaza doar pe documente relevante |
| US-03 | Client | Nu mai vad cereri retrase | Nu incarc fisiere pentru o cerere anulata |
| US-04 | Admin | Vad cine a retras cererea | Pot audita schimbarea |

---

## 7. Product Behavior

### 7.1 Project UI

- Actiunea **Sterge din proiect** este disponibila pe cererile active pentru admin si consultant.
- Actiunea apare atat pentru cereri generale, cat si pentru cereri atasate unei activitati.
- Actiunea nu apare pentru client.
- Cererea dispare din lista activa dupa succes.

### 7.2 Confirmation

Confirmarea afiseaza:

- numele cererii;
- proiectul;
- faza/activitatea, daca exista;
- statusul curent;
- numarul de fisiere incarcate, daca exista;
- mesajul: `Template-ul nu va fi modificat. Istoricul cererii ramane pastrat.`

Butonul final este **Sterge din proiect**. Textul UI poate folosi verbul "sterge", dar implementarea ramane soft delete.

### 7.3 After Retirement

- Cererea retrasa nu mai apare in listele active.
- Un client care are pagina veche deschisa nu mai poate incarca fisiere pe ea.
- Review-ul, reasignarea si reminder-ele pentru cererea retrasa sunt respinse server-side.
- Datele istorice raman disponibile pentru audit si eventual restore ulterior.
- Fisierele active deja incarcate nu mai apar in cronologia activa a proiectului deoarece sunt marcate soft-deleted; randurile din `files` si obiectele din storage raman pastrate.

---

## 8. Functional Requirements

| ID | Requirement |
|----|-------------|
| FR-01 | Endpoint-ul de retragere identifica cererea si proiectul ei inainte de autorizare. |
| FR-02 | Adminul poate retrage cereri din orice proiect la care are acces administrativ. |
| FR-03 | Consultantul poate retrage cereri din proiectele la care are acces de lucru. |
| FR-04 | Clientul primeste `403` la orice incercare de retragere. |
| FR-05 | O cerere retrasa este exclusa implicit din query-urile active de cereri. |
| FR-06 | Cererea retrasa nu mai accepta uploads, review sau editari operationale. |
| FR-07 | Actiunea scrie audit cu actor, proiect, cerere, status anterior si timestamp. |
| FR-08 | Endpoint-ul este idempotent pentru o cerere deja retrasa: returneaza succes cu starea existenta, nu modifica din nou auditul operational. |
| FR-09 | Retragerea cererii seteaza `files.deleted_at` si `files.deleted_by` pe uploadurile active ale cererii si nu sterge obiecte din bucket. |

---

## 9. Data and API Contract

### 9.1 Data Model

`document_requirements` are nevoie de campuri echivalente cu:

| Field | Purpose |
|-------|---------|
| `deleted_at` | Marcheaza retragerea din fluxul activ |
| `deleted_by` | Pastreaza actorul |
| `delete_reason` | Motiv optional pentru audit operational |

`files` are nevoie de campurile de soft delete folosite deja pentru filtrarea fisierelor active:

| Field | Purpose |
|-------|---------|
| `deleted_at` | Marcheaza uploadul ca retras din fluxul activ odata cu cererea |
| `deleted_by` | Pastreaza actorul care a retras cererea |

La retragerea cererii, uploadurile ei active (`files.requirement_id = requestId` si `files.deleted_at is null`) primesc acelasi `deleted_at` si acelasi `deleted_by` ca `document_requirements`. Randurile din `files` nu sunt hard-deleted, nu se sterg obiecte din bucket in acest flow, iar fisierele deja soft-deleted nu sunt rescrise. Daca ulterior se construieste un view de audit/recovery, acesta poate citi fisierele istorice printr-un endpoint separat si explicit autorizat.

### 9.2 API

Ruta recomandata:

`DELETE /api/document-requests/[requestId]`

Comportament:

1. incarca cererea si `project_id`;
2. valideaza accesul prin proiect si rolul;
3. genereaza valorile comune `deleted_at` si `deleted_by`;
4. seteaza campurile de soft delete pe `document_requirements`;
5. seteaza aceleasi campuri de soft delete pe uploadurile active din `files` pentru cerere;
6. scrie audit o singura data pentru tranzitia activa -> retrasa;
7. returneaza succes fara a afecta template-ul.

Rutele care incarca sau modifica cereri trebuie sa trateze `deleted_at` ca stare terminala pentru fluxul activ.
Rutele active de listare trebuie sa filtreze implicit `document_requirements.deleted_at is null` si `files.deleted_at is null` pentru uploaduri. Filtrul pe upload nu inlocuieste filtrul pe cererea parinte.

---

## 10. Implementation Surface

- `components/DocumentRequests.tsx`
- componenta de confirmare delete deja existenta sau un modal echivalent
- `app/api/document-requests/[requestId]/route.ts`
- rutele de uploads/review/reminder/edit care trebuie sa respinga cereri retrase
- query-urile care listeaza `document_requirements`
- tipurile DB generate dupa migrare

---

## 11. Test Matrix

| Scenario | Expected result |
|----------|-----------------|
| Admin retrage cerere fara fisiere | Cererea dispare din view-ul activ, audit scris |
| Consultant retrage cerere cu fisiere | Cererea dispare, fisierele raman in DB/storage cu `files.deleted_at` si `files.deleted_by` setate pentru uploadurile active |
| Client incearca endpoint-ul | `403` |
| Client incearca upload dupa retragere | Request respins server-side |
| Cererea provenea din template | Template-ul ramane neschimbat |
| Cererea este retrasa de doua ori | Raspuns succes/idempotent, fara audit duplicat |

---

## 12. Acceptance Criteria

- [ ] Adminul si consultantul autorizat pot folosi **Sterge din proiect** pe o cerere activa.
- [ ] Stergerea din proiect este soft delete.
- [ ] Template-ul sursa nu este modificat.
- [ ] Cererea retrasa nu mai apare clientului in fluxul activ.
- [ ] Upload, review si reminder nu mai functioneaza pentru cererea retrasa.
- [ ] Uploadurile active existente sunt soft-deleted in `files`, iar randurile si obiectele din storage raman pastrate.
- [ ] Audit log-ul retine actorul, proiectul si cererea retrasa.
- [ ] Endpoint-ul de retragere este idempotent pentru o cerere deja retrasa.

---

*End of document*
