<!-- labels: enhancement -->
# Calendar general pentru consultant

## Context
Consultantul lucrează în mai multe proiecte simultan, dar nu are o vedere de ansamblu asupra termenelor din toate proiectele sale.

## Cerință
Consultantul trebuie să aibă un **calendar general** cu termenele din toate proiectele în care lucrează:
- include **fazele, activitățile și cererile de documente**;
- permite **filtrarea după proiect, client și tipul termenului**;
- selectarea unui eveniment **deschide direct elementul** corespunzător din proiect.

## Criterii de acceptare
- [ ] Pagină/secțiune de calendar general pentru consultant, cu termenele din toate proiectele unde este membru.
- [ ] Filtre funcționale: proiect, client, tip element (fază / activitate / cerere de document).
- [ ] Click pe eveniment navighează direct la elementul din proiectul respectiv.
- [ ] Adminul vede calendarul pentru toate proiectele (de confirmat cu echipa; recomandare: da).

## Note tehnice
- Reutilizează componenta de calendar din *Calendar în pagina proiectului* — a se construi acolo ca componentă generică.
- Necesită un endpoint agregat (ex. `GET /api/my-calendar`) care adună termenele din proiectele consultantului; funcția DB `get_upcoming_deadlines` existentă poate fi punct de plecare, dar trebuie extinsă cu cererile de documente și fazele.
- Aceeași sursă de date poate alimenta și secțiunea de „termene apropiate" din noul Home.

## Dependențe
- După: *Calendar în pagina proiectului* (componenta comună + decizia privind termenul fazelor).
