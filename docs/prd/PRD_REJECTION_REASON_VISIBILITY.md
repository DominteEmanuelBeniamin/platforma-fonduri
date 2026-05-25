# PRD: Motivul respingerii pentru cereri de documente

- **Product:** Bonie
- **Feature:** Rejection Reason Visibility
- **Status:** Draft for implementation
- **Date:** 2026-05-21
- **Author:** GaMa
- **Source ticket:** `nu apare motivul mereu la respingere cerere de document`

---

## 1. Decision Summary

| Decision | MVP contract |
|----------|--------------|
| Source of truth | Motivul apartine unui review event, nu unui rand arbitrar din `files` |
| Rejection rule | Respingerile necesita motiv si ultima versiune de upload evaluabila |
| UI value | API-ul furnizeaza `latest_rejection` explicit |
| Current `files.comments` | Nu mai este sursa principala pentru afisare |
| History | Fiecare aprobare/respingere creeaza istoric de review |

---

## 2. Problem

Statusul **Respins** fara motiv este incomplet. Clientul vede ca documentul nu a fost acceptat, dar nu stie ce trebuie corectat.

In implementarea curenta, motivul este scris pe ultimul fisier gasit la review si UI-ul il cauta tot in fisiere. Asta este fragil:

- un batch poate avea mai multe fisiere;
- ordinea fisierelor in payload poate varia;
- review-ul este o actiune de business, nu o proprietate a unui singur fisier;
- ruta curenta poate ajunge la status respins chiar daca nu are un fisier pe care sa salveze comentariul.

---

## 3. Goal

Cand o versiune de document este respinsa, motivul ultimei respingeri este pastrat ca eveniment de review, returnat explicit de API si afisat consecvent in fluxul clientului.

---

## 4. Existing Product Context

- `POST /api/document-requests/[requestId]/review` cere `notes` la `rejected`.
- Ruta scrie `comments` pe ultimul fisier incarcat, daca exista.
- `components/DocumentRequests.tsx` si `components/DocumentModal.tsx` cauta motivul in `request.files`.
- Fisierele au `version_number`, iar upload-ul trece cererea in status `review`.

---

## 5. Scope

### 5.1 In Scope

- Persistenta robusta a motivului de respingere.
- Istoric minim pentru aprobarile si respingerile cererii.
- Afisarea ultimei respingeri in card si modal.
- Fallback pentru date istorice incomplete.
- Validare server-side pentru review invalid.

### 5.2 Out of Scope

- Comentarii threaded intre client si consultant.
- Template-uri de feedback.
- Editarea motivelor dupa ce review-ul a fost trimis.
- Conversia audit log-ului in sursa de adevar pentru review.

---

## 6. User Stories

| ID | As a... | I want to... | So that... |
|----|---------|--------------|------------|
| US-01 | Client | Vad motivul respingerii langa cerere | Stiu ce trebuie reincarcat |
| US-02 | Consultant | Nu pot respinge fara explicatie | Feedback-ul catre client este complet |
| US-03 | Admin | Vad cine a respins si de ce | Pot verifica istoricul deciziei |
| US-04 | Client | Vad acelasi motiv in card si modal | Nu primesc instructiuni divergente |

---

## 7. Product Behavior

### 7.1 Rejection

- Consultantul/adminul completeaza feedback.
- Butonul de respingere este blocat sau valideaza clar cand feedback-ul este gol.
- API-ul respinge orice `rejected` fara motiv.
- API-ul respinge review-ul daca nu exista o versiune de upload evaluabila.
- Versiunea evaluata este ultima versiune incarcata la momentul review-ului, nu un fisier ales arbitrar din batch.

### 7.2 Client Visibility

Cand cererea este in status `rejected`, ultima respingere afiseaza:

- titlul **Motiv respingere**;
- textul motivului;
- data review-ului, daca UI-ul are loc;
- numele consultantului/adminului, daca politica de afisare permite.

Motivul apare:

- pe cardul cererii din tab-ul **Documente**;
- in modalul cererii;
- langa actiunea de reincarcare.

Daca cererea nu mai este in status `rejected`, `latest_rejection` poate ramane in payload pentru istoric, dar UI-ul activ nu il prezinta ca motiv curent decat unde exista context de istoric.

### 7.3 Legacy Fallback

Daca o cerere istorica este `rejected` si nu exista review event sau motiv recuperabil:

- clientul vede un mesaj explicit ca motivul nu este disponibil;
- adminul/consultantul vede acelasi fallback, nu un camp gol;
- noul flux nu produce astfel de cazuri.

---

## 8. Functional Requirements

| ID | Requirement |
|----|-------------|
| FR-01 | Un review `rejected` are `reason` non-empty. |
| FR-02 | Un review se leaga de cerere, reviewer si versiunea evaluata. |
| FR-03 | Endpoint-ul de lista al cererilor returneaza `latest_rejection` explicit. |
| FR-04 | Cardul si modalul folosesc acelasi camp `latest_rejection`. |
| FR-05 | Un nou upload nu sterge istoricul respingerilor anterioare. |
| FR-06 | Audit log-ul continua sa inregistreze review-ul, dar UI-ul nu parseaza audit pentru feedback. |
| FR-07 | Cererile istorice fara motiv au fallback UI. |
| FR-08 | Review-ul `approved` si `rejected` este refuzat daca nu exista fisiere active pentru cererea evaluata. |
| FR-09 | `files.comments` poate ramane ca metadata legacy, dar fluxul nou nu il foloseste ca sursa de adevar pentru motiv. |

---

## 9. Data and API Contract

### 9.1 Review History

Tabela recomandata: `document_request_reviews`

| Field | Purpose |
|-------|---------|
| `id` | Identificator review |
| `requirement_id` | Cererea evaluata |
| `action` | `approved` sau `rejected` |
| `reason` | Obligatoriu pentru `rejected`, `null` pentru `approved` |
| `reviewed_version_number` | Versiunea de upload evaluata |
| `reviewed_by` | Actor |
| `reviewed_at` | Timestamp |

Fisierul individual poate pastra metadata proprie, dar decizia de review ramane la nivel de review event.

### 9.2 API Response

Payload-ul consumat de UI trebuie sa includa o forma stabila:

```ts
type LatestRejection = {
  reason: string
  reviewed_at: string
  reviewed_by: { id: string; full_name: string | null } | null
  reviewed_version_number: number
} | null
```

UI-ul nu trebuie sa deduca motivul din `request.files[request.files.length - 1]`.

`latest_rejection` este cel mai recent review event cu `action = rejected` pentru cerere. Pentru afisarea motivului curent, UI-ul il foloseste numai cand statusul cererii este `rejected`.

### 9.3 Migration

- Pentru date vechi, un backfill poate copia best-effort comentariile existente din fisiere in review events.
- Backfill-ul nu inventeaza motive.
- Cazurile fara motiv recuperabil raman marcate prin fallback.
- Daca exista mai multe fisiere in aceeasi versiune cu comentarii diferite, backfill-ul trebuie sa marcheze cazul ca ambiguu sau sa aleaga o regula determinista documentata.

---

## 10. Implementation Surface

- `app/api/document-requests/[requestId]/review/route.ts`
- `app/api/projects/[id]/document-requests/route.ts`
- `components/DocumentRequests.tsx`
- `components/DocumentModal.tsx`
- schema DB, tipuri generate si eventual backfill

---

## 11. Test Matrix

| Scenario | Expected result |
|----------|-----------------|
| Respinge fara motiv | API refuza |
| Respinge fara upload evaluabil | API refuza |
| Respinge versiunea 1, client reincarca versiunea 2 | Motivul vechi ramane in istoric |
| Dupa reincarcare cererea intra in review | Motivul vechi nu este afisat ca motiv curent de respingere |
| Cerere cu mai multe fisiere in acelasi batch | Un singur review reason stabil |
| Refresh dupa respingere | Card si modal arata acelasi motiv |
| Cerere legacy fara motiv | Fallback explicit |

---

## 12. Acceptance Criteria

- [ ] Nu se poate crea o respingere fara motiv.
- [ ] Review-ul respins este persistat ca event de review cu versiune evaluata.
- [ ] Cererea respinsa afiseaza motivul dupa refresh.
- [ ] Cardul si modalul citesc aceeasi valoare `latest_rejection`.
- [ ] Motivul nu depinde de ordinea randurilor din `files`.
- [ ] Datele legacy fara motiv afiseaza fallback clar.
- [ ] Dupa un upload nou, motivul vechi ramane in istoric dar nu este prezentat ca respingerea curenta.

---

*End of document*
