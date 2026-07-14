<!-- labels: enhancement,ux -->
# Ecran centralizat cu toate taskurile (administrator)

## Context
Activitățile (taskurile) se văd în prezent doar în interiorul fiecărui proiect. Administratorul nu are o listă globală din care să vadă ce urmează la termen în toate lucrările.

## Cerință
Administratorul trebuie să aibă un ecran în care **toate taskurile din toate lucrările** sunt afișate unele sub altele. Pentru fiecare task se vede:

- **lucrarea** (proiectul),
- **consultantul alocat**,
- **stadiul**,
- **data termenului**.

Taskurile sunt afișate în **ordinea crescătoare a datelor**, începând cu termenul cel mai apropiat.

## Criterii de acceptare
- [ ] Ecranul listează toate activitățile din toate proiectele, una sub alta, sortate crescător după termen (cel mai apropiat primul).
- [ ] Fiecare rând afișează: proiectul, consultantul alocat, stadiul și termenul (cu codul de culoare existent pentru urgență).
- [ ] Taskurile fără termen apar la sfârșitul listei.
- [ ] Click pe un task deschide direct activitatea în pagina proiectului.
- [ ] Lista rămâne rapidă cu volum mare (paginare sau încărcare progresivă).
- [ ] Accesibil doar administratorului.

## De clarificat cu echipa
- „Task" înseamnă doar **activitățile**, sau se includ și **cererile de documente** cu termen? (Recomandare: doar activitățile, cu un filtru opțional care le include și pe cereri — documentul menționează „taskuri", adică activități.)
- Sunt necesare filtre (proiect, consultant, stadiu)? Documentul nu le cere — recomandare: da, minimal (dropdown proiect + consultant).

## Note tehnice
- View-ul `project_activities_complete` din DB conține deja aproape tot ce trebuie (activitate, proiect, asignat, status, deadline) — endpoint-ul devine în mare parte un `SELECT` sortat + paginat, protejat cu `requireAdmin`.
- Codul de culoare pentru urgența termenelor există deja (`getDaysRemainingColor` în `types/database.ts`) — se refolosește.
- Deep-link-ul către activitate refolosește mecanismul din *Căutare în proiect* (ancoră per element).

## Dependențe
- Independent ca date; deep-link-ul depinde de mecanismul din *Căutare în proiect și faze pliabile*.
- De proiectat vizual în aceeași familie cu *Tabloul de bord pentru administrator* (pot împărți aceeași pagină/secțiune — de decis la design).
