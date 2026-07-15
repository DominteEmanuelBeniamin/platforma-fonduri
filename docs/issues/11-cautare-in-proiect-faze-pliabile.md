<!-- labels: enhancement,ux -->
# Căutare în întregul proiect și faze pliabile

## Context
Pagina proiectului afișează permanent toate detaliile; nu există căutare, iar găsirea unei activități sau cereri într-un proiect mare necesită derulare manuală.

## Cerință
- În pagina proiectului trebuie să existe o **căutare** care găsește faze, activități și cereri de documente. Selectarea unui rezultat deschide direct zona în care se află elementul.
- **Fazele trebuie să poată fi pliate și depliate individual**, pentru ca pagina să nu afișeze permanent toate detaliile.

## Criterii de acceptare
- [ ] Câmp de căutare vizibil în pagina proiectului; **căutare după cuvânt cheie** în numele/descrierea fazelor, activităților și cererilor de documente.
- [ ] Cuvântul cheie găsit este **evidențiat (highlight)** în rezultate și în elementul deschis *(feedback Gabriel, 15 iul 2026)*.
- [ ] Selectarea unui rezultat depliază faza corespunzătoare, derulează la element și îl evidențiază.
- [ ] Fiecare fază poate fi pliată/depliată individual; starea se păstrează pe durata sesiunii.
- [ ] Pentru rolul de client, căutarea NU returnează elemente „În pregătire".

## Note tehnice
- Căutarea se poate face client-side pe datele deja încărcate în pagină (dimensiunea unui proiect o permite); nu necesită endpoint nou.
- Necesită mecanism de deep-link/scroll-to (ancoră per element) — același mecanism va fi refolosit de calendar și de centrul de notificări.
- Face parte din refacerea paginii de proiect — de proiectat împreună.

## Dependențe
- De proiectat împreună cu: *Refacerea paginii unui proiect*.
- Trebuie să respecte: *Faze și activități În pregătire/Public*.
