<!-- labels: enhancement,ux -->
# Tablou de bord general pentru administrator

## Context
Administratorul nu are în prezent o vedere de ansamblu: pagina principală listează proiectele fără nivel de implementare, responsabil sau termene, iar fosta pagină de „Overview" a devenit pagina de Șabloane.

## Cerință
Administratorul trebuie să aibă un **Tablou de bord** în care apar **toate lucrările și proiectele**. Pentru fiecare lucrare se vede:

- **nivelul de implementare** (progres),
- **stadiul curent**,
- **consultantul responsabil**,
- **termenele apropiate**.

Tabloul de bord include și un **calendar general cu toate evenimentele și termenele**, indiferent de lucrarea sau proiectul din care fac parte.

## Criterii de acceptare
- [ ] Tabloul de bord afișează toate proiectele, cu: progres (nivel de implementare), stadiul curent, consultantul responsabil și termenele apropiate.
- [ ] Calendarul general afișează termenele din toate proiectele (faze, activități, cereri de documente), cu filtrare după proiect/tip.
- [ ] Click pe un termen/eveniment deschide direct elementul corespunzător din proiect.
- [ ] Pagina rămâne utilizabilă și rapidă cu multe proiecte (sortare implicită după urgență, încărcare eficientă).
- [ ] Stilul respectă aceleași principii minimaliste ca noul Home (compact, fără scroll inutil).

## De clarificat cu echipa
- **Cine este „consultantul responsabil"?** Proiectele au o echipă (`project_members`) cu mai mulți consultanți, nu un responsabil unic. Variante: (a) se adaugă un rol de „responsabil" pe proiect (coloană nouă / flag pe membru), (b) se afișează toată echipa. Recomandare: (a) — un responsabil explicit, cerința îl presupune.

## Note tehnice
- View-ul `project_progress_view` există deja în DB (progres, stadiu curent, faza curentă) — punct de plecare pentru datele tabloului.
- Calendarul general refolosește componenta de calendar din *Calendar în pagina proiectului* și endpoint-ul agregat din *Calendar general pentru consultant* (varianta admin = toate proiectele, nu doar cele proprii).
- Necesită endpoint agregat de admin (ex. `GET /api/admin/dashboard`), protejat cu `requireAdmin`.
- Dacă se alege varianta cu responsabil explicit: migrare SQL mică (ex. `is_lead` pe `project_members`) — de grupat cu batch-ul de migrări.

## Dependențe
- După: *Calendar în pagina proiectului* (componenta) și *Calendar general pentru consultant* (endpoint-ul agregat).
- De proiectat vizual în aceeași familie cu *Refacerea paginii Home*.
