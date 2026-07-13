<!-- labels: enhancement -->
# Șabloane cu stările „Ciornă" și „Publicat"

## Context
În prezent șabloanele pot fi create și modificate **doar de administrator** (rutele `/api/admin/templates/*` sunt protejate cu `requireAdmin`). Nu există un flux de verificare înainte ca un șablon să devină utilizabil.

## Cerință
- Un șablon în starea **Ciornă** poate fi creat și editat de consultant și administrator.
- După verificare, administratorul îl **publică**.
- După publicare, consultantul poate **vedea** șablonul, dar nu îl mai poate edita. Numai administratorul îl mai poate modifica.

## Criterii de acceptare
- [ ] Șabloanele au starea `Ciornă` sau `Publicat`, vizibilă în lista de șabloane.
- [ ] Consultantul poate crea șabloane noi (în stare Ciornă) și poate edita orice șablon aflat în Ciornă.
- [ ] Doar administratorul poate publica un șablon.
- [ ] După publicare, consultantul vede șablonul dar nu îl poate modifica; administratorul poate în continuare.
- [ ] Publicarea și trecerile de stare sunt înregistrate în audit.

## Note tehnice
- **Migrare SQL**: coloană `status` (`draft` / `published`) pe `project_templates` (+ valoare pentru șabloanele existente — probabil `published`).
- Guard-urile actuale `requireAdmin` de pe rutele de șabloane trebuie înlocuite cu o verificare dependentă de stare (consultant + draft = permis). Recomandare: un helper centralizat de permisiuni în `app/api/_utils/auth.ts` (ex. `canEditTemplate(profile, template)`), reutilizabil și pentru *Drepturi noi pentru consultanți*.
- **De clarificat cu echipa**: la crearea unui proiect, `TemplateSelector` ar trebui să ofere doar șabloanele **publicate** (recomandat: da).
- Impact asupra propagării șablon → proiecte: propagarea ar trebui permisă doar din șabloane publicate.

## Dependențe
- Legat de: *Drepturi noi pentru consultanți* (același refactor de permisiuni).
- Migrarea SQL se aplică manual (Sandu) — de grupat cu celelalte migrări din etapa de fundații.
