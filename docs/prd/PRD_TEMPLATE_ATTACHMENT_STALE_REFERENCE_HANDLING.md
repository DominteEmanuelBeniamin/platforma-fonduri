# PRD: Integritatea atasamentelor folosite de template-uri

- **Product:** Bonie
- **Feature:** Template Attachment Integrity
- **Status:** Draft for implementation
- **Date:** 2026-05-21
- **Author:** GaMa
- **Source ticket:** `daca se sterge un document din baza de date care e adaugat la un template, inca apare in template si da eroare la descarcare`

---

## 1. Decision Summary

| Decision | MVP contract |
|----------|--------------|
| Invalid reference | Un template nu trateaza un atasament lipsa ca fisier descarcabil |
| App-side delete | Stergerea care afecteaza un atasament referit trebuie sa blocheze sau sa detaseze explicit referinta |
| Existing stale data | UI-ul marcheaza referinta lipsa si ofera repair |
| New project import | Nu copiaza `attachment_path` lipsa in proiect nou |
| Current storage model | MVP poate pastra `attachment_path`, dar ii impune verificari de integritate |

---

## 2. Problem

Un template poate ramane cu o referinta catre un atasament care nu mai exista. UI-ul continua sa arate fisierul, iar esecul apare abia la descarcare.

Acesta nu este doar un bug de afisare. Referinta stale poate fi copiata la import in proiecte noi, deci o eroare de integritate se multiplica in fluxuri live.

---

## 3. Goal

Atasamentele folosite de template-uri au un lifecycle controlat:

- delete-urile din aplicatie nu lasa referinte noi invalide;
- referintele invalide deja existente sunt vizibile si reparabile;
- proiectele noi nu primesc `attachment_path` catre fisiere lipsa din template.

---

## 4. Existing Product Context

- `template_document_requirements.attachment_path` retine referinta la modelul din template.
- Importul din `app/api/projects/[id]/import-template/route.ts` copiaza acel path in `document_requirements.attachment_path`.
- Editorul de template reconstruieste numele afisat din path.
- Download-ul este semnat la cerere; prezenta unui path in DB nu garanteaza ca obiectul mai exista.

---

## 5. Defect Boundary

Implementarea trebuie sa reproduca si sa testeze separat cauzele posibile:

| Cause | Example |
|-------|---------|
| DB reference stale | Randul referit a fost sters sau detasat incomplet |
| Storage object missing | `attachment_path` a ramas in DB, dar obiectul nu mai exista in bucket |

MVP-ul acopera simptomul in ambele cazuri: nu afiseaza succes fals, nu ofera download fals si nu propaga link mort. Implementarea poate marca referinta ca missing, dar aceasta marcare nu este un substitut pentru a evita copierea path-ului invalid in proiecte noi.

---

## 6. Scope

### 6.1 In Scope

- Verificare de integritate pentru atasamentele template folosite in editare, download si import.
- UI state **Fisier indisponibil** in editor.
- Repair actions: inlocuire atasament sau detasare referinta.
- Protectie pentru delete-urile declansate din aplicatie.
- Raport sau query de identificare a referintelor stale existente.
- Warning explicit la import cand un model din template a fost omis pentru ca lipseste.

### 6.2 Out of Scope

- File asset registry complet pentru tot storage-ul.
- Garbage collection globala.
- Repararea automata a unui fisier lipsa fara input de la admin.
- Propagarea automata a atasamentului reparat catre proiecte existente.

---

## 7. User Stories

| ID | As a... | I want to... | So that... |
|----|---------|--------------|------------|
| US-01 | Admin | Vad ca modelul unui template lipseste | Il repar inainte de folosire |
| US-02 | Admin | Nu sterg silentios un atasament folosit | Nu stric template-uri active |
| US-03 | Consultant | Nu primesc proiecte noi cu download invalid | Clientul poate folosi modelele livrate |
| US-04 | User | Primesc eroare clara la fisier lipsa | Inteleg ca problema nu este browserul meu |

---

## 8. Product Behavior

### 8.1 Template Editor

Pentru un atasament valid:

- numele apare normal;
- download-ul este activ;
- adminul poate inlocui atasamentul.

Pentru o referinta invalida:

- UI-ul afiseaza **Fisier indisponibil**;
- download-ul nu promite succes;
- adminul poate **Inlocui fisierul** sau **Elimina referinta**.

### 8.2 Download

Cand atasamentul lipseste:

- endpoint-ul returneaza eroare controlata;
- UI-ul afiseaza mesaj de reparare, nu eroare generica;
- restul template-ului ramane editabil.

### 8.3 Import

Importul unui template verifica atasamentele copiate in proiect.

| State | Import behavior |
|-------|-----------------|
| Atasament valid | Copiaza referinta |
| Atasament lipsa | Creeaza cererea fara `attachment_path` si raporteaza warning adminului |

Importul nu trebuie sa introduca o referinta despre care serverul stie deja ca este invalida. Daca un atasament lipseste, cererea din proiect se creeaza in continuare, dar fara model atasat; warning-ul trebuie sa permita adminului sa stie ce documente trebuie reparate in template.

---

## 9. Functional Requirements

| ID | Requirement |
|----|-------------|
| FR-01 | Prezenta lui `attachment_path` singura nu este tratata ca dovada de disponibilitate. |
| FR-02 | Delete-urile din aplicatie care pot invalida un atasament template verifica referintele existente. |
| FR-03 | Editorul template poate reprezenta `valid`, `missing` si `none` pentru atasament. |
| FR-04 | Atasamentul lipsa are repair action prin inlocuire sau detasare. |
| FR-05 | Download-ul pentru atasament lipsa raspunde cu eroare controlata. |
| FR-06 | Importul nu copiaza `attachment_path` pentru o referinta cunoscuta ca lipsa. |
| FR-07 | Exista o cale de scanare a referintelor stale istorice. |
| FR-08 | Repararea prin replace sau detach reseteaza explicit statusul missing si scrie audit. |

---

## 10. Data and API Contract

### 10.1 MVP Contract for `attachment_path`

MVP-ul poate continua cu `attachment_path`, dar serverul trebuie sa controleze punctele de risc:

- attach;
- replace;
- detach/delete;
- signed download;
- import din template in proiect.

Pe termen lung, daca atasamentele devin reuse assets cu mai multi referenti, un `file_assets` record cu lifecycle si referinte este mai corect decat un raw path.

Pentru MVP, un atasament este considerat disponibil doar daca serverul poate obtine un signed URL functional sau poate verifica obiectul in storage prin API-ul providerului. `attachment_path` prezent in DB nu este suficient.

### 10.2 Attachment Status

Editorul are nevoie de un status explicit:

```ts
type TemplateAttachmentStatus = 'none' | 'valid' | 'missing'
```

Statusul poate fi obtinut la editarea template-ului sau la verificarea atasamentului, dar UI-ul nu trebuie sa trateze `path !== null` ca `valid`.

Campurile de tip `attachment_missing_at` si `attachment_missing_checked_at` pot fi folosite ca cache operational. La replace sau detach se reseteaza; la un nou esec de download/import se actualizeaza.

### 10.3 Repair Audit

Actiunile de inlocuire si detasare trebuie auditate cu:

- actor;
- template document requirement ID;
- path vechi;
- path nou sau `null`;
- timestamp.

---

## 11. Implementation Surface

- editorul `app/admin/templates/page.tsx`
- rutele pentru template document attachment init/update/delete
- ruta de import template catre proiect
- ruta de signed download pentru atasamente de cerere
- scan/repair pentru referinte stale

---

## 12. Test Matrix

| Scenario | Expected result |
|----------|-----------------|
| Template cu atasament valid | Download activ si import copiaza referinta |
| Storage object lipsa | UI marcheaza missing si download este controlat |
| Admin detaseaza referinta | Template nu mai arata fisier |
| Admin inlocuieste fisier lipsa | Status revine valid |
| Import cu referinta missing | Proiectul nu primeste link mort, iar raspunsul include warning cu documentul afectat |
| Delete path din aplicatie asupra fisierului referit | Referinta nu ramane stale silentios |

---

## 13. Acceptance Criteria

- [ ] Editorul nu mai prezinta atasamentul lipsa drept fisier descarcabil valid.
- [ ] Download-ul pentru atasament lipsa are eroare controlata si mesaj util.
- [ ] Adminul poate repara referinta prin replace sau detach.
- [ ] Delete-urile relevante din aplicatie nu lasa referinte template invalide fara handling explicit.
- [ ] Importul unui template nu copiaza o referinta cunoscuta ca lipsa in proiect nou.
- [ ] Importul raporteaza warning pentru atasamente omise din cauza lipsei fisierului.
- [ ] Referintele stale istorice pot fi identificate pentru cleanup.

---

*End of document*
