<!-- labels: enhancement -->
# Duplicarea fazelor și activităților

## Context
Există deja duplicare la nivel de șablon întreg (`/api/admin/templates/[templateId]/duplicate`), dar nu se pot duplica faze sau activități individuale — nici în șabloane, nici în proiecte.

## Cerință
- În **șabloane** și în **proiecte** trebuie să poată fi duplicată o fază sau o activitate, cu structura și cererile de documente din interior.
- Copierea **nu include** documentele încărcate anterior de client.
- Copia poate fi redenumită și reordonată, fără reconstruirea manuală a conținutului de la zero.

## Criterii de acceptare
- [ ] O fază poate fi duplicată (în șablon și în proiect) împreună cu activitățile și cererile de documente din interior.
- [ ] O activitate poate fi duplicată (în șablon și în proiect) împreună cu cererile de documente.
- [ ] Fișierele încărcate de client NU sunt copiate; cererile din copie pornesc de la starea „Așteaptă document".
- [ ] Fișierele-model (template) atașate cererilor SUNT copiate/referențiate corect.
- [ ] Copia primește un nume distinct (ex. sufix „(copie)"), poate fi redenumită și reordonată.
- [ ] Duplicarea este înregistrată în audit.

## Note tehnice
- Se extinde modelul din ruta de duplicare a șablonului (deep-copy).
- Atenție la: unicitatea slug-urilor, inserarea la `order_index` corect (imediat după original — interacționează cu funcționalitatea de reordonare), resetarea câmpurilor de stare (`status`, `started_at`, `completed_at`, asignări — de clarificat dacă asignarea consultantului se păstrează; recomandare: da).
- Pentru fazele din proiect: copia trebuie să păstreze `project_status_id` și referințele `source_template_*` să fie puse pe NULL (copia nu mai e legată de șablon pentru propagare) — de confirmat comportamentul dorit cu echipa.

## Dependențe
- Interacționează cu: reordonarea (issue #21 existent) și *Mai multe fișiere-model atașate aceleiași cereri* (schema atașamentelor).
