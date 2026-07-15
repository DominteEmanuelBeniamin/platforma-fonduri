<!-- labels: enhancement,ux -->
# Calendar în pagina proiectului

## Context
Termenele (deadline-uri) există pe activități și pe cererile de documente, dar nu există o vedere calendaristică; utilizatorii le văd doar în liste.

## Cerință
Pagina proiectului trebuie să includă un **calendar** cu termenele fazelor, activităților și cererilor de documente.

- Calendarul permite **filtrarea după fază sau tip de element**.
- Selectarea unui termen **deschide elementul corespunzător**.

## Criterii de acceptare
- [ ] Calendarul afișează termenele activităților (`deadline_at`) și ale cererilor de documente (`deadline_at`).
- [ ] Calendarul afișează termenele fazelor (vezi decizia de mai jos).
- [ ] Filtrare după fază și după tip de element (fază / activitate / cerere de document).
- [ ] Click pe un eveniment deschide elementul corespunzător (deep-link în pagina proiectului).
- [ ] Pentru rolul de client, calendarul NU afișează elemente „În pregătire".

## ⚠️ Decizie de produs necesară înainte de implementare
`project_phases` **nu are coloană de termen** (are doar `started_at`/`completed_at`; șabloanele au `estimated_days`). Pentru „termenele fazelor" există două variante:
1. Se adaugă coloană `deadline_at` pe `project_phases` (migrare SQL — de grupat cu etapa de fundații), sau
2. Termenul fazei se derivează din cel mai târziu deadline al activităților ei.

Recomandare: varianta 1 (termen explicit, editabil), cu varianta 2 ca fallback de afișare.

**Machetă UX înainte de implementare** *(feedback Gabriel, 15 iul 2026)*: de decis forma — **tabel/listă cu termenele pe faze** sau **Gantt chart**. Recomandare: listă/agendă + vedere lunară simplă în prima versiune; Gantt doar dacă aduce valoare reală (efort de implementare vizibil mai mare).

## Note tehnice
- Componenta de calendar trebuie construită reutilizabil — va fi refolosită de *Calendarul general pentru consultant*.
- Datele există deja în răspunsul paginii de proiect; nu ar trebui să fie nevoie de endpoint nou pentru varianta per-proiect.
- Face parte din refacerea paginii de proiect — de proiectat împreună.

## Dependențe
- De proiectat împreună cu: *Refacerea paginii unui proiect*.
- Trebuie să respecte: *Faze și activități În pregătire/Public*.
- Blocat de decizia privind termenul fazelor (mai sus).
