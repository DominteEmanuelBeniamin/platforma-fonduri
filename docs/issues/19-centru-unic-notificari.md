<!-- labels: enhancement -->
# Centru unic de notificări

## Context
Tabelul `notifications` și funcția `create_notification` există în schema bazei de date, dar **nu sunt folosite nicăieri în aplicație**. Singurele mecanisme de „necitit" existente sunt cele de chat (proiect + privat), fiecare cu implementare proprie.

## Cerință
Platforma trebuie să aibă **un singur centru de notificări** în care utilizatorul vede toate notificările primite:
- **grupate pe proiect** și **ordonate cronologic**;
- notificările **necitite evidențiate**;
- selectarea unei notificări **deschide direct** proiectul, activitatea, cererea de document sau conversația relevantă.

## Criterii de acceptare
- [ ] Există o iconiță de notificări (clopoțel) în navbar, cu badge pentru necitite, vizibilă pentru toate rolurile.
- [ ] Centrul afișează notificările grupate pe proiect, cronologic, cu stare citit/necitit.
- [ ] Click pe notificare marchează ca citită și navighează direct la elementul relevant (deep-link).
- [ ] Se generează notificări pentru evenimentele-cheie: document încărcat/aprobat/respins, cerere nouă, publicare fază/activitate, adăugare în echipă, termen apropiat, mesaj nou.
- [ ] Există acțiune „marchează tot ca citit".

### Plasare UI *(feedback Gabriel, 15 iul 2026)*
Propunere: gruparea pe proiecte să apară imediat sub butonul de notificări (dropdown), cu observația că poate scădea lizibilitatea. Recomandare: **hibrid** — dropdown-ul de sub clopoțel arată ultimele ~10 notificări strict cronologic (fiecare rând cu eticheta proiectului), iar „Vezi toate" deschide pagina completă, unde gruparea pe proiect + filtrele au sens fără să sufere lizibilitatea.

## Note tehnice
- **Fundație pentru alte cerințe**: *Email direct din platformă* și *Remindere automate* trebuie construite peste același serviciu. Recomandare: un serviciu unic `notify(userId, type, entity, link)` în `app/api/_utils/` care (1) scrie în `notifications` și (2) opțional trimite email prin Resend — un singur loc de fan-out.
- Producătorii de evenimente se adaugă în rutele existente (upload, review, publicare etc.) — de corelat cu extinderea auditului.
- De decis: chatul rămâne cu mecanismul propriu de unread sau se integrează în centru (recomandare: mesajele apar și în centru, mecanismul de unread al chatului rămâne).
- Tipurile din `NotificationType` (`types/database.ts`) acoperă deja majoritatea cazurilor.

## Dependențe
- Trebuie să respecte: *Faze și activități În pregătire/Public* (clientul nu primește notificări despre elemente nepublicate).
- Fundație pentru: *Email direct din platformă*, *Remindere automate*.
