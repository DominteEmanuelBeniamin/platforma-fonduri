<!-- labels: enhancement,audit -->
# Istoricul tuturor acțiunilor în audit

## Context
Auditul există (`audit_logs` + helper `app/api/_utils/audit.ts` + pagina `/admin/audit`), iar extinderea acoperirii are deja un PRD (`docs/prd/PRD_AUDIT_LOG_COVERAGE_EXPANSION.md`). Noile funcționalități introduc acțiuni care trebuie jurnalizate.

## Cerință
Pentru **toate funcționalitățile noi**, acțiunile realizate se înregistrează în jurnalul de audit. Pentru fiecare acțiune se văd: **utilizatorul, data și ora, proiectul sau elementul afectat și modificarea efectuată**.

Acțiuni de acoperit: crearea, editarea, ștergerea, **publicarea**, **reordonarea**, asignarea, încărcarea și verificarea documentelor, **trimiterea notificărilor/emailurilor** și **modificarea drepturilor**.

## Criterii de acceptare
- [ ] Fiecare issue din acest set include jurnalizarea în audit ca parte din definiția de „gata" (nu se amână la final).
- [ ] Tipurile de entitate din audit sunt extinse unde e nevoie (ex. notificare, email, atașament chat, publicare șablon/fază/activitate).
- [ ] Pagina `/admin/audit` filtrează corect după noile tipuri de acțiuni/entități.
- [ ] Pentru fiecare înregistrare se văd utilizatorul, momentul, entitatea afectată și modificarea (old/new values unde are sens).

## Note tehnice
- `AuditEntityType` din `types/database.ts` trebuie extins; verificat că migrarea `20260526000001_audit_logs_drop_type_checks.sql` a eliminat deja constrângerile CHECK (deci extinderea e doar la nivel de tipuri TS + UI de filtrare).
- **Recomandare de proces**: acest issue este transversal — se folosește ca checklist la review-ul fiecărui PR din setul de cerințe, nu ca o etapă separată de implementare la final.

## Dependențe
- Transversal — se aplică tuturor celorlalte issue-uri.
