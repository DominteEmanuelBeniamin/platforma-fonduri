# PRD: Modele si atasamente interne in cronologia Documente

- **Product:** Bonie
- **Feature:** Project Document Timeline Entry Types
- **Status:** Draft for implementation
- **Date:** 2026-05-21
- **Author:** GaMa
- **Source ticket:** `sa apara documentele incarcate de admini/consultanti in cronologia aia "Documente" care este per fiecare proiect. momentan apar doar fisierele incarcate de clienti acolo`

---

## 1. Decision Summary

| Decision | MVP contract |
|----------|--------------|
| Timeline scope | Cronologia afiseaza submissions si atasamente active de cerere |
| Internal file meaning | In MVP, "intern" inseamna model/atasament incarcat pe o cerere de admin sau consultant |
| Private files | Nu exista in MVP in aceasta cronologie |
| Labels | Randurile au tip explicit: `Fisier incarcat` sau `Model/atasament cerere` |
| Uploader label | Se afiseaza doar cand metadata este reala; nu se ghiceste din storage path |

---

## 2. Problem

Tab-ul **Documente** pare cronologia completa a proiectului, dar randurile actuale sunt construite doar din `req.files`. Astfel, modelele si atasamentele de cerere puse de admini sau consultanti raman vizibile doar in contextul punctual al cererii.

Consecinta este o cronologie incompleta:

- echipa cauta un model in mai multe locuri;
- clientul nu vede usor ce fisier i-a fost pus la dispozitie;
- acelasi tab comunica mai putin decat sugereaza numele lui.

---

## 3. Goal

Cronologia **Documente** afiseaza, in acelasi view, atat fisierele incarcate pentru cereri, cat si modelele/atasamentele active ale cererilor din proiect.

---

## 4. Existing Product Context

- `components/ProjectDocumentsView.tsx` transforma `req.files` in `DriveRow`.
- `document_requirements.files` contine fisierele incarcate pentru review.
- `document_requirements.attachment_path` contine modelul/atasamentul incarcat la cerere.
- Atasamentele pentru cererile proiectului sunt incarcate doar de admin sau consultant prin ruta de init dedicata.
- `DriveFilesView` afiseaza randuri, filtre si download pentru tipul de date primit.

---

## 5. Scope

### 5.1 In Scope

- Intrare de timeline pentru fiecare fisier din `files`.
- Intrare de timeline pentru fiecare `attachment_path` activ pe cerere activa.
- Tip si origine vizibila pe rand.
- Download autorizat pentru ambele tipuri.
- Sortare coerenta si empty state corect.

### 5.2 Out of Scope

- Un drive generic de fisiere interne independente de cereri.
- Fisiere private ale echipei.
- Folder management.
- Timeline pentru atasamente retrase sau cereri soft-deleted.
- Deduplicarea globala a storage-ului.

---

## 6. Entry Types

MVP-ul are doua tipuri de rand:

| Entry type | Source | Meaning |
|------------|--------|---------|
| `submission_file` | `files` | Fisier incarcat pentru cererea de document |
| `request_attachment` | `document_requirements.attachment_path` | Model sau atasament pus la dispozitie pe cerere |

Un rand `request_attachment` nu este un document aprobat si nu foloseste statusul de review ca si cum ar fi upload de client.

---

## 7. User Stories

| ID | As a... | I want to... | So that... |
|----|---------|--------------|------------|
| US-01 | Consultant | Vad modelul cererii in cronologia proiectului | Il gasesc fara sa deschid fiecare cerere |
| US-02 | Admin | Vad intr-un loc fisierele si atasamentele cererilor | Verific rapid continutul proiectului |
| US-03 | Client | Disting modelul primit de fisierul incarcat de mine | Nu confund input-ul cu livrabilul |
| US-04 | User | Descarc din timeline doar ce am voie sa vad | Fluxul ramane sigur |

---

## 8. Product Behavior

### 8.1 Timeline Row

Fiecare rand afiseaza cand datele exista:

- numele cererii;
- tipul intrarii;
- faza si activitatea;
- data relevanta;
- status de review numai pentru `submission_file`;
- actiune de download.

### 8.2 Labels

Label-urile minime:

| Entry type | Label |
|------------|-------|
| `submission_file` | `Fisier incarcat` |
| `request_attachment` | `Model/atasament cerere` |

Cand uploader-ul real exista in metadata, UI-ul il poate afisa. Daca atasamentul provine din template sau metadata lipseste, UI-ul ramane la label-ul de tip si nu inventeaza actor.

### 8.3 Visibility

- Randurile respecta permisiunile existente ale proiectului.
- Clientul vede un atasament numai daca acel atasament este deja destinat fluxului cererii vizibile clientului.
- Daca se introduce ulterior notiunea de fisier intern privat, acel tip nu intra implicit in cronologie.

---

## 9. Functional Requirements

| ID | Requirement |
|----|-------------|
| FR-01 | Timeline-ul include `submission_file` si `request_attachment`. |
| FR-02 | Fiecare rand are `entry_type` explicit. |
| FR-03 | Statusul cererii nu este prezentat ca status de review pentru `request_attachment`. |
| FR-04 | Download-ul pentru fiecare tip foloseste endpoint autorizat, nu storage path expus. |
| FR-05 | Sortarea ramane stabila cand tipurile de rand sunt mixte. |
| FR-06 | Cererile retrase nu emit randuri active in timeline. |
| FR-07 | Lipsa metadata de uploader nu produce label fals. |

---

## 10. Data and API Contract

### 10.1 Typed Timeline DTO

Se recomanda un DTO explicit pentru timeline:

```ts
type ProjectDocumentTimelineEntry =
  | {
      entry_type: 'submission_file'
      file_id: string
      request_id: string
      request_name: string
      version_number: number
      created_at: string
      status: 'pending' | 'review' | 'approved' | 'rejected'
    }
  | {
      entry_type: 'request_attachment'
      request_id: string
      request_name: string
      display_at: string | null
    }
```

DTO-ul poate fi calculat initial din payload-ul existent, dar tipurile trebuie sa ramana distincte in componenta. `display_at` foloseste timestamp-ul real al atasamentului cand exista; daca schema curenta nu il pastreaza, UI-ul poate avea fallback fara a inventa o data falsa.

### 10.2 Download Contract

| Entry type | Download path |
|------------|---------------|
| `submission_file` | endpoint de signed download pentru file ID |
| `request_attachment` | endpoint de signed download pentru atasamentul cererii |

UI-ul nu construieste URL-uri de storage.

---

## 11. Implementation Surface

- `components/ProjectDocumentsView.tsx`
- `components/DriveFilesView.tsx`
- payload-ul care incarca documentele proiectului sau un endpoint de timeline dedicat
- rutele de signed download deja existente pentru file si request attachment

---

## 12. Test Matrix

| Scenario | Expected result |
|----------|-----------------|
| Cerere cu upload client | Rand `submission_file` existent |
| Cerere cu atasament si fara upload | Rand `request_attachment` vizibil |
| Cerere cu ambele tipuri | Doua randuri distincte, etichetate corect |
| Atasament fara uploader real | Nu se inventeaza actor |
| Cerere retrasa | Nu apare in timeline activ |
| Client descarca atasament vizibil | Download autorizat |

---

## 13. Acceptance Criteria

- [ ] Cronologia `Documente` include fisierele incarcate si atasamentele active ale cererilor.
- [ ] Fiecare rand arata tipul corect al intrarii.
- [ ] Modelul/atasamentul nu este prezentat drept document incarcat pentru review.
- [ ] Download-ul functioneaza prin endpoint autorizat pentru ambele tipuri.
- [ ] Randurile cu metadata incompleta au fallback corect.
- [ ] Nu sunt expuse fisiere private inexistente in modelul MVP.

---

*End of document*
