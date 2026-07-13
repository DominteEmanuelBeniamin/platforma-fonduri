<!-- labels: enhancement,security -->
# Drepturi noi pentru consultanți

## Context
În prezent doar administratorul poate crea proiecte (`app/api/projects/route.ts` — `allowed = new Set(['admin'])`), iar consultanții au drepturi limitate pe structura proiectelor.

## Cerință
- Consultantul **poate crea proiecte**.
- Consultantul poate **adăuga, edita, reordona și șterge faze și activități** în proiectele în care lucrează.
- Consultantul **NU poate șterge proiecte** — ștergerea rămâne doar la administrator.
- Consultantul **NU poate accesa** paginile de Audit sau Utilizatori (neschimbat).

## Criterii de acceptare
- [ ] Consultantul poate crea un proiect nou; la creare este adăugat automat ca membru în `project_members` (altfel nu și-ar putea accesa propriul proiect).
- [ ] Consultantul poate adăuga/edita/reordona/șterge faze și activități în proiectele unde este membru.
- [ ] Consultantul nu poate șterge proiecte (buton ascuns în UI + refuz 403 în API).
- [ ] Consultantul nu are acces la `/admin/audit` și `/admin/users` (UI + API).
- [ ] Toate acțiunile noi permise consultantului sunt înregistrate în audit.

## Note tehnice
- Recomandare arhitecturală: în loc de verificări `role === '...'` împrăștiate în rute, un **helper centralizat de permisiuni** în `app/api/_utils/auth.ts` (ex. `can(profile, 'project.create')`, `can(profile, 'phase.delete', ctx)`). Același helper acoperă și regulile stării Ciornă/Publicat de la șabloane.
- De verificat fiecare rută de mutație pe faze/activități (`app/api/projects/[id]/phases/**`) — unele pot avea restricții doar-admin implicite.
- Navbar-ul și paginile trebuie să reflecte noile drepturi (butoane vizibile pentru consultant).

## Dependențe
- Legat de: *Șabloane cu stările Ciornă și Publicat* (același refactor de permisiuni — de făcut împreună).
