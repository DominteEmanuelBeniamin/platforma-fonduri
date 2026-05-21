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
| Existing uploads | Raman in DB si storage pentru audit si recovery |
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
| FR-08 | Endpoint-ul este idempotent pentru o cerere deja retrasa sau returneaza un conflict controlat, nu o stare partiala. |

---

## 9. Data and API Contract

### 9.1 Data Model

`document_requirements` are nevoie de campuri echivalente cu:

| Field | Purpose |
|-------|---------|
| `deleted_at` | Marcheaza retragerea din fluxul activ |
| `deleted_by` | Pastreaza actorul |
| `delete_reason` | Motiv optional pentru audit operational |

Nu se sterg randuri din `files` si nu se sterg obiecte din bucket in acest flow.

### 9.2 API

Ruta recomandata:

`DELETE /api/document-requests/[requestId]`

Comportament:

1. incarca cererea si `project_id`;
2. valideaza accesul prin proiect si rolul;
3. seteaza campurile de soft delete;
4. scrie audit;
5. returneaza succes fara a afecta template-ul.

Rutele care incarca sau modifica cereri trebuie sa trateze `deleted_at` ca stare terminala pentru fluxul activ.

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
| Consultant retrage cerere cu fisiere | Cererea dispare, fisierele raman pastrate |
| Client incearca endpoint-ul | `403` |
| Client incearca upload dupa retragere | Request respins server-side |
| Cererea provenea din template | Template-ul ramane neschimbat |
| Cererea este retrasa de doua ori | Raspuns controlat fara corupere de date |

---

## 12. Acceptance Criteria

- [ ] Adminul si consultantul autorizat pot folosi **Sterge din proiect** pe o cerere activa.
- [ ] Stergerea din proiect este soft delete.
- [ ] Template-ul sursa nu este modificat.
- [ ] Cererea retrasa nu mai apare clientului in fluxul activ.
- [ ] Upload, review si reminder nu mai functioneaza pentru cererea retrasa.
- [ ] Fisierele existente raman pastrate.
- [ ] Audit log-ul retine actorul, proiectul si cererea retrasa.

---

*End of document*
