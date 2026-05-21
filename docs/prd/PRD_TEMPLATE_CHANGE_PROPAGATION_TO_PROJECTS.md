# PRD: Propagarea modificarilor de template catre proiecte existente

- **Product:** Bonie
- **Feature:** Template Change Propagation
- **Status:** Draft with architecture gate
- **Date:** 2026-05-21
- **Author:** GaMa
- **Source ticket:** `la o modificare a templateului care este deja in folosire, sa fie un prompt in care sa poti alege care din proiectele care il folosesc sa fie updatate`

---

## 1. Decision Summary

| Decision | MVP contract |
|----------|--------------|
| Save behavior | Salvarea template-ului nu modifica automat niciun proiect |
| Prompt behavior | Dupa save, adminul poate deschide flow-ul de propagare pentru proiectele eligibile |
| MVP changes | Doar adaugari de structura provenite din template |
| Destructive changes | Stergeri si override-uri peste customizari locale sunt out of scope |
| Matching | Se face prin lineage IDs, niciodata prin nume |
| Existing projects without lineage | Sunt afisate ca neeligibile pana la backfill sigur |

**Architecture gate:** nu se implementeaza `apply` pentru propagare pana cand proiectele pot fi legate sigur de nodurile sursa din template. Matching-ul dupa nume produce update-uri gresite la rename, duplicate si customizari locale.

---

## 2. Problem

Template-ul este copiat in proiect la import. Dupa aceea, proiectul continua independent. Cand adminul corecteaza sau extinde template-ul, proiectele deja create raman in urma.

Problema reala nu este doar lipsa unui prompt. Problema este lipsa unui mecanism controlat care spune:

- ce schimbare a fost salvata;
- care proiecte pot primi schimbarea in siguranta;
- ce se va adauga in fiecare proiect;
- cine a confirmat propagarea.

---

## 3. Goal

Dupa salvarea unui template folosit deja in proiecte, adminul poate selecta proiecte eligibile si poate propaga adaugari de structura preview-uite si auditate.

---

## 4. Existing Product Context

- `app/api/projects/[id]/import-template/route.ts` copiaza faze, activitati si cereri de documente in proiect.
- `projects.template_id` pastreaza template-ul de origine la nivel de proiect.
- Codul curent nu arata lineage stabil intre `template_phases` si `project_phases`, intre `template_activities` si `project_activities`, sau intre `template_document_requirements` si `document_requirements`.
- Fluxul curent de editare template salveaza entitati direct si poate sterge documente din template fara a crea un change set de propagare.

Aceste constrangeri fac imposibila o propagare generica sigura fara model de lineage.

---

## 5. Scope

### 5.1 In Scope

- Prompt dupa save pentru template folosit in proiecte.
- Preview de proiecte eligibile/neeligibile.
- Selectie de proiecte tinta.
- Propagare aditiva pentru:
  - faze noi;
  - activitati noi;
  - cereri de documente noi;
  - atasamente/model files aferente elementelor nou adaugate.
- Audit si rezultat per proiect.

### 5.2 Out of Scope

- Stergerea automata a cererilor din proiecte.
- Renume, descrieri sau alte update-uri care suprascriu valori deja existente in proiect.
- Detectarea automata a customizarilor locale fara model dedicat.
- Propagarea catre proiecte fara lineage sigur.
- Rollback one-click si scheduled propagation.

---

## 6. Why MVP Is Additive

Adaugarile pot fi facute idempotent daca exista parinte sursa si identificator de origine. Stergerile si update-urile peste noduri existente au risc diferit:

| Change type | Risk |
|-------------|------|
| Add | Duplicare daca nu exista lineage |
| Rename/update | Poate suprascrie o customizare locala |
| Delete | Poate ascunde istoric, fisiere si obligatii live |

Ticketul nu trebuie transformat intr-un sync engine bidirectional intr-un singur release.

---

## 7. User Stories

| ID | As a... | I want to... | So that... |
|----|---------|--------------|------------|
| US-01 | Admin | Sunt anuntat dupa editarea unui template folosit | Pot decide daca proiectele existente trebuie extinse |
| US-02 | Admin | Vad proiectele eligibile si impactul | Nu aplic schimbari orbeste |
| US-03 | Admin | Selectez doar proiectele necesare | Fac rollout controlat |
| US-04 | Consultant | Vad in proiect noile cereri propagate | Pot continua fluxul cu clientul |
| US-05 | Admin | Vad auditul propagarii | Pot explica cine a schimbat proiectele |

---

## 8. Product Flow

1. Adminul salveaza template-ul.
2. Sistemul detecteaza proiecte cu acel `template_id`.
3. Daca exista proiecte candidate, UI-ul afiseaza promptul **Actualizeaza proiecte existente**.
4. Preview-ul afiseaza change set-ul propagabil si eligibilitatea proiectelor.
5. Adminul selecteaza proiectele eligibile.
6. Confirmarea afiseaza numarul de proiecte si de elemente noi.
7. Apply-ul creeaza elementele lipsa in proiectele selectate.
8. Rezultatul afiseaza `applied`, `skipped` sau `failed` per proiect.

---

## 9. Functional Requirements

| ID | Requirement |
|----|-------------|
| FR-01 | Save-ul template-ului si apply-ul pe proiecte sunt actiuni separate. |
| FR-02 | Promptul apare numai pentru template-uri folosite de cel putin un proiect. |
| FR-03 | Preview-ul arata change set-ul aditiv care poate fi propagat. |
| FR-04 | Preview-ul separa proiectele eligibile de proiectele fara lineage sau blocate de date invalide. |
| FR-05 | Adminul poate selecta un subset de proiecte eligibile. |
| FR-06 | Apply-ul nu creeaza duplicate daca acelasi change set este aplicat din nou. |
| FR-07 | Apply-ul nu modifica noduri create manual in proiect. |
| FR-08 | Apply-ul nu hard-delete si nu soft-delete cereri existente. |
| FR-09 | Auditul retine actorul, template-ul, change set-ul, proiectele si rezultatul per proiect. |

---

## 10. Data and Architecture Contract

### 10.1 Required Lineage

Importul din template trebuie sa pastreze originea pentru fiecare nivel propagabil:

| Project entity | Required source reference |
|----------------|---------------------------|
| `project_phases` | `source_template_phase_id` |
| `project_activities` | `source_template_activity_id` |
| `document_requirements` | `source_template_document_requirement_id` |

Un marker de revision sau change set aplicat este obligatoriu pentru a sti ce update a ajuns in proiect.

### 10.2 Template Change Set

O salvare care poate fi propagata trebuie sa produca sau sa poata reconstrui un change set stabil:

- `template_id`;
- `revision_id`;
- entitati adaugate;
- relatiile lor de parinte;
- actor si timestamp.

Nu se calculeaza apply comparand doar texte curente din template cu texte curente din proiect.

### 10.3 Existing Projects

Proiectele create inainte de introducerea lineage-ului au doua variante:

| State | Behavior |
|-------|----------|
| Backfill sigur | Devin eligibile |
| Backfill ambiguu | Raman neeligibile si preview-ul explica motivul |

Backfill-ul nu are voie sa presupuna identitate doar pentru ca numele coincid.

### 10.4 Apply Idempotency

Pentru fiecare element creat in proiect, combinatia dintre proiect si source reference trebuie sa previna duplicatele. Apply-ul repetat pentru acelasi change set trebuie sa dea `skipped` pentru elementele deja existente.

---

## 11. API and Implementation Surface

Rute recomandate:

- `POST /api/admin/templates/[templateId]/propagation/preview`
- `POST /api/admin/templates/[templateId]/propagation/apply`

Zone afectate:

- editorul din `app/admin/templates/page.tsx`;
- importul initial din `app/api/projects/[id]/import-template/route.ts`;
- schema pentru lineage si revision/change-set records;
- audit log si raportul de aplicare.

---

## 12. Non-Functional Requirements

| Category | Requirement |
|----------|-------------|
| Safety | Niciun proiect nu este modificat la simplul save al template-ului |
| Correctness | Matching-ul se face prin IDs de origine |
| Reliability | Apply-ul este idempotent per proiect si change set |
| Auditability | Fiecare propagare are rezultat verificabil |
| Performance | Preview-ul ramane utilizabil pentru sute de proiecte candidate |

---

## 13. Test Matrix

| Scenario | Expected result |
|----------|-----------------|
| Template nefolosit | Nu apare prompt de propagare |
| Proiect cu lineage | Preview eligibil si apply aditiv |
| Proiect fara lineage | Preview neeligibil cu motiv |
| Apply repetat | Nu apar duplicate |
| Cerere creata manual in proiect | Nu este modificata |
| Template are stergere | Stergerea nu este propagata in MVP |

---

## 14. Acceptance Criteria

- [ ] Save-ul template-ului nu modifica automat proiecte existente.
- [ ] Dupa save, adminul poate deschide preview pentru proiectele candidate.
- [ ] Preview-ul afiseaza proiecte eligibile si neeligibile cu motiv.
- [ ] Adminul poate selecta un subset de proiecte eligibile.
- [ ] MVP-ul propaga doar adaugari de structura.
- [ ] Apply-ul foloseste lineage IDs si nu matching dupa nume.
- [ ] Apply-ul repetat nu dubleaza faze, activitati sau cereri.
- [ ] Auditul retine schimbarea aplicata si rezultatul per proiect.

---

*End of document*
