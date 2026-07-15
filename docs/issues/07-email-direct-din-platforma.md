<!-- labels: enhancement -->
# Email trimis direct din platformă către clienți

## Context
În prezent, butonul „Reminder" generează un link `mailto:` (`lib/document-reminder.ts`) — emailul pleacă din inboxul personal al consultantului. Resend este deja integrat punctual (o singură utilizare, în fluxul de cereri de documente).

## Cerință
Platforma trebuie să trimită emailuri direct către client, **în numele firmei**, fără folosirea inboxului personal al consultantului. Emailul trebuie să includă un mesaj clar și un **link direct** către proiectul, activitatea sau cererea de document relevantă.

## Criterii de acceptare
- [ ] Consultantul poate declanșa trimiterea unui email către client direct din platformă (fără `mailto:`).
- [ ] Emailul pleacă de pe adresa firmei (expeditor configurat), nu de pe adresa consultantului.
- [ ] Emailul conține mesajul, contextul (proiect/activitate/cerere) și un link direct către elementul respectiv.
- [ ] Trimiterea emailului este înregistrată în audit (cine, când, către cine, ce entitate).
- [ ] Eșecurile de trimitere sunt vizibile utilizatorului (mesaj de eroare clar).
- [ ] **Folosirea Resend este documentată** în repo (configurare domeniu, SPF/DKIM, variabile de mediu, fluxul de trimitere, limitări) *(feedback Gabriel, 15 iul 2026)*.

## Note tehnice
- Trimitere prin Resend (`RESEND_API_KEY`, `RESEND_FROM_EMAIL` există deja în env). Necesită domeniu verificat în Resend (SPF/DKIM) pentru livrare în numele firmei.
- Link-urile directe se construiesc cu `NEXT_PUBLIC_APP_URL`.
- Recomandare arhitecturală: nu implementați trimiterea izolat — construiți-o peste serviciul comun de notificări (vezi *Centru unic de notificări*): eveniment → notificare în aplicație + email. Astfel *Remindere automate* refolosește același mecanism.
- Șabloanele de text existente din `lib/document-reminder.ts` (tonuri în funcție de urgență) pot fi refolosite ca șabloane de email.

## Dependențe
- Recomandat după/împreună cu: *Centru unic de notificări*.
