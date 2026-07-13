<!-- labels: enhancement,ux -->
# Refacerea paginii unui proiect

## Context
Pagina proiectului (`app/projects/[id]/page.tsx` + componentele `ProjectPhasesSidebar`, `DocumentRequests`, `DriveFilesView`, `ProjectChatDrawer`) a crescut organic; informațiile importante necesită navigare între tab-uri și derulare excesivă.

## Cerință
Pagina proiectului trebuie reorganizată astfel încât informațiile și acțiunile importante să fie poziționate eficient și să încapă, pe cât posibil, într-o singură pagină.

- Titlul, clientul, starea proiectului, echipa și acțiunile principale trebuie să fie vizibile imediat.
- Fazele, activitățile, documentele, calendarul, Drive-ul și chatul trebuie să fie accesibile clar, fără navigare inutilă și fără aglomerarea paginii.

## Criterii de acceptare
- [ ] Header-ul paginii afișează: titlu, client, stare proiect, echipă și acțiunile principale, fără derulare.
- [ ] Fazele, activitățile, documentele, calendarul, Drive-ul și chatul sunt accesibile din pagină fără navigare inutilă.
- [ ] Conținutul principal încape, pe cât posibil, într-un singur ecran (fără aglomerare).
- [ ] Comportamentul existent (schimbare status, asignare, cereri de documente) rămâne funcțional după refacere.

## Note tehnice
- **Atenție la scop**: căutarea în proiect, fazele pliabile, calendarul și Drive-ul pe dosare (issue-uri separate) se vor integra în această pagină. Design-ul trebuie făcut o singură dată, pentru toate — altfel pagina se reproiectează de două ori.
- Recomandare: o etapă de design/wireframe aprobată înainte de implementare, apoi implementare incrementală pe componente.

## Dependențe
- De proiectat împreună cu: *Căutare în întregul proiect și faze pliabile*, *Calendar în pagina proiectului*, *Drive organizat pe dosare*, *Refacerea paginii Home*.
