<!-- labels: enhancement,ux -->
# Refacerea paginii principale (Home) pentru client și consultant

## Context
Pagina principală (`app/page.tsx`) afișează în prezent lista proiectelor aproape identic pentru toate rolurile, cu carduri mari și secțiuni care ocupă mult spațiu vertical. Singurul indicator „live" existent este badge-ul de mesaje necitite din chat.

## Cerință
Pagina principală se reface într-un stil **cât mai minimalist**: o listă compactă de proiecte, în care fiecare proiect comunică starea sa prin **indicatori de notificare color-coded pe card**, nu prin secțiuni separate de conținut.

### Principii de design (obligatorii)
- **Minimalist**: fără secțiuni voluminoase, fără blocuri de statistici mari, fără text redundant. Titlul proiectului este elementul dominant al cardului.
- **Fără scroll în cazul obișnuit**: pagina trebuie să încapă într-un singur ecran pentru un număr normal de proiecte. Cardurile sunt compacte (înălțime mică, densitate mare — listă sau grid dens). Dacă utilizatorul are foarte multe proiecte, scroll-ul este acceptat — dar design-ul nu are voie să provoace scroll prin elemente decorative sau spațiere generoasă.
- **Informația de stare = badge-uri pe card**, nu liste separate pe pagină.

### Indicatori de notificare pe card (color-coded)
Fiecare card de proiect preia modelul badge-ului de mesaje necitite existent și îl generalizează pentru **toate tipurile de evenimente**, fiecare cu culoarea lui:

| Indicator | Culoare | Semnificație (exemple) |
|---|---|---|
| 💬 Mesaje | albastru | mesaje necitite în chatul proiectului |
| 📄 Documente | galben/amber | consultant: documente încărcate care așteaptă verificare; client: documente noi primite de la consultant |
| ⏰ Termene | portocaliu | termene apropiate (activități / cereri de documente) |
| 🔴 Urgențe | roșu | termene depășite; documente respinse care necesită reîncărcare |

- Badge-urile afișează numărul de elemente (ca badge-ul de mesaje actual).
- Un card fără evenimente nu afișează niciun badge (zero zgomot vizual).
- Click pe un badge duce direct în zona relevantă a proiectului (chat, documente, calendar).

### Conținut per rol
- **Client**: doar lista proiectelor sale, cu titlu, status proiect și badge-urile de mai sus. **NU se afișează o secțiune de „acțiuni cerute" pe Home** — starea se comunică exclusiv prin badge-urile de pe carduri.
- **Consultant**: lista proiectelor de care răspunde, cu aceleași badge-uri; cererile care așteaptă verificare și urgențele sunt vizibile ca badge-uri pe cardul proiectului respectiv, cu acces rapid (click pe badge) la activitatea necesară — nu ca listă separată care ocupă pagina.

## Criterii de acceptare
- [ ] Înainte de implementare există **2 variante de machetă** și o **listă a conținutului afișat per rol** (o propune Emanuel), aprobate în echipă *(feedback Gabriel, 15 iul 2026)*.
- [ ] Cardurile de proiect sunt compacte: titlu clar vizibil, status și badge-uri; fără alte informații.
- [ ] Pentru un număr uzual de proiecte, pagina încape într-un singur ecran, fără scroll.
- [ ] Fiecare card afișează badge-uri numerice color-coded pentru: mesaje necitite, documente (în verificare / noi, după rol), termene apropiate, urgențe (depășite/respinse).
- [ ] Badge-urile respectă rolul utilizatorului (clientul vede doar ce îl privește; consultantul vede ce are de verificat).
- [ ] Clientul NU are secțiune de „acțiuni cerute" pe Home.
- [ ] Click pe badge navighează direct la zona corespunzătoare din proiect (deep-link).
- [ ] Cardurile fără evenimente nu afișează badge-uri.
- [ ] Pagina se încarcă printr-un număr mic de cereri către API (ideal una singură, agregată).

## Note tehnice
- Se recomandă un endpoint agregat (ex. `GET /api/dashboard`) care întoarce proiectele + numărătorile per tip de badge într-un singur răspuns, în loc de fetch-uri separate per proiect (`/api/projects/chat/unread` returnează deja numărători per proiect — modelul se extinde la celelalte tipuri).
- Culorile badge-urilor trebuie aliniate cu convențiile existente din `types/database.ts` (config-urile de status) și cu componenta de mesaje din issue-ul *Mesaje clare în aplicație*.
- Numărătorile pentru client trebuie să respecte vizibilitatea (*Faze și activități În pregătire/Public*) — clientul nu primește numărători din elemente nepublicate.
- Refacerea vizuală trebuie proiectată împreună cu refacerea paginii de proiect (issue „Refacerea paginii unui proiect"), pentru un limbaj vizual unitar.
- După implementarea *Centrului unic de notificări*, numărătorile badge-urilor se pot alimenta din același serviciu de notificări.

## Dependențe
- De proiectat împreună cu: *Refacerea paginii unui proiect*.
- Trebuie să respecte: *Faze și activități În pregătire/Public*.
- Se integrează ulterior cu: *Centru unic de notificări*.
