<!-- labels: enhancement,ux -->
# Mesaje clare în aplicație — refacerea TUTUROR mesajelor (toast, erori, confirmări)

## Context
Unele mesaje informative sunt prezentate vizual ca și cum ar fi erori, ceea ce creează incertitudine pentru utilizator. Mesajele sunt implementate inconsistent, pe alocuri ad-hoc, în fiecare pagină/componentă.

## Cerință
**Se refac TOATE mesajele din aplicație** — nu doar cele problematice:

- toate mesajele **toast** existente;
- toate mesajele de **eroare** (inclusiv erorile venite din API, care nu trebuie afișate brut către utilizator);
- toate **confirmările**, **informările** și **avertismentele**.

Fiecare mesaj trebuie să indice clar, prin aspect, ce este: **confirmare** (succes), **informare**, **avertisment** sau **eroare**. Nu rămâne niciun mesaj pe vechiul stil.

## Criterii de acceptare
- [ ] Există o componentă unică de mesaje (toast/alert) cu 4 variante vizuale distincte: succes (verde), informare (albastru), avertisment (galben), eroare (roșu), fiecare cu iconiță proprie.
- [ ] **Inventar complet**: toate locurile din aplicație care afișează mesaje sunt identificate și listate în PR (pagini + componente).
- [ ] **100% din mesaje migrate** la noua componentă — niciun toast, alert sau mesaj de eroare pe stilul vechi nu mai există în aplicație.
- [ ] Niciun mesaj informativ sau de confirmare nu mai este afișat cu stil de eroare.
- [ ] Erorile din API sunt traduse în mesaje clare în română, pe înțelesul utilizatorului (nu se afișează mesaje tehnice brute de tip „Failed to fetch" sau corpuri de răspuns JSON).
- [ ] Mesajele de eroare indică, unde este posibil, ce poate face utilizatorul (ex. „Reîncearcă", „Verifică fișierul").
- [ ] Textele tuturor mesajelor sunt revizuite: scurte, clare, în română, cu ton consecvent.

## Note tehnice
- Componentă nouă în `components/` (ex. `Toast.tsx` / `AlertMessage.tsx`) + provider/context global pentru toast-uri, ca orice pagină să le poată declanșa identic.
- Punct central de tratare a erorilor de API: extinderea `lib/apiFetch.ts` ca erorile să fie normalizate într-un singur loc (cod → mesaj prietenos), nu tratate diferit în fiecare componentă.
- Zone cu multe mesaje de migrat: `DocumentRequests.tsx`, `DocumentModal.tsx`, `admin/templates/page.tsx`, `UserDrawer.tsx`, `TeamManager.tsx`, paginile de admin, fluxurile de upload.
- Efort mediu (volumul e în migrare + revizuirea textelor, nu în componentă). Candidat pentru prima etapă — noile pagini (Home, proiect) trebuie să folosească de la început noul sistem.

## Dependențe
- De finalizat **înaintea** refacerilor de UX (*Home*, *pagina proiectului*), ca acestea să folosească direct noul sistem de mesaje.
