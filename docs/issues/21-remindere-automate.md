<!-- labels: enhancement,infra -->
# Remindere automate

## Context
Reminderele sunt în prezent **manuale**: consultantul apasă „Reminder" și se generează un link `mailto:`. Nu există niciun proces programat (cron/job) în platformă.

## Cerință
Platforma trimite **automat** remindere înaintea termenelor pentru faze, activități și cereri de documente.

- Reminderele ajung **utilizatorilor responsabili** și, când este necesar, **clientului** care trebuie să încarce un document.
- Mesajul indică: **proiectul, acțiunea necesară, termenul și linkul direct** către elementul respectiv.

## Criterii de acceptare
- [ ] Remindere trimise automat la praguri definite înaintea termenului (propunere: 7 zile, 3 zile, 1 zi — de confirmat cu echipa).
- [ ] Destinatari corecți: consultantul asignat pentru activități; clientul pentru cererile de documente în așteptare; fallback către echipa proiectului dacă nu există asignare.
- [ ] Emailul conține proiectul, acțiunea, termenul și link direct.
- [ ] **Idempotență**: același reminder nu se trimite de două ori (nici la rulări suprapuse ale jobului).
- [ ] Nu se trimit remindere pentru elemente finalizate, sărite, șterse sau (către client) nepublicate.
- [ ] Reminderele trimise apar în audit și în centrul de notificări.

## Note tehnice
- **Prima procesare programată din platformă — decizie de infrastructură necesară**: Vercel Cron care apelează o rută API protejată (ex. `POST /api/cron/reminders` cu secret) sau Supabase pg_cron/Edge Function. Recomandare: Vercel Cron (aplicația e deja pe Vercel, logica rămâne în Next.js).
- **Migrare SQL**: tabel `sent_reminders` (entitate, prag, destinatar, dată) pentru idempotență.
- Se construiește peste serviciul de notificări (*Centru unic de notificări*) și infrastructura de email (*Email direct din platformă*) — nu se implementează trimitere separată.
- Tonurile de mesaj în funcție de urgență din `lib/document-reminder.ts` se refolosesc ca șabloane.

## Dependențe
- După: *Centru unic de notificări* și *Email direct din platformă*.
- Migrarea SQL se grupează cu celelalte.
