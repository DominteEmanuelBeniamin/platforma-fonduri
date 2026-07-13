<!-- labels: bug -->
# [Bug] Eroare la deschiderea cererilor de documente din rolul de client

## Context
A fost identificat un bug la deschiderea unei cereri de document din rolul de **client**. Bugul afectează fluxul principal al clientului (vizualizare cerere + încărcare document).

## Cerință
Clientul trebuie să poată deschide cererea de document:
- din pagina principală (Home),
- din pagina proiectului,

și să vadă: **descrierea, termenul, modelele atașate, ultima versiune încărcată și starea cererii**.

## Pași de reproducere (de completat la investigare)
1. Autentificare cu un cont de client.
2. Deschiderea unei cereri de document din Home / pagina proiectului.
3. _Comportament observat: de documentat (eroare / conținut lipsă)._

## Criterii de acceptare
- [ ] Cauza este identificată și documentată în issue.
- [ ] Clientul poate deschide cererea din ambele locuri fără eroare.
- [ ] În detaliul cererii se văd: descrierea, termenul, modelele atașate, ultima versiune și starea.
- [ ] Este acoperit și cazul cererilor fără model atașat / fără fișiere încărcate.

## Note tehnice
- Zone probabile: `components/DocumentModal.tsx`, `components/DocumentRequests.tsx`, `app/api/my-document-requests/route.ts` și guard-urile de acces pentru rolul client (`requireProjectAccess`).
- **Prioritate maximă** — afectează direct clientul; candidat pentru prima etapă (remedieri rapide).

## Dependențe
- Fără dependențe.
