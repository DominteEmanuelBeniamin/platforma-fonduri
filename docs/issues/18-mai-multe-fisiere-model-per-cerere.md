<!-- labels: enhancement -->
# Mai multe fișiere-model atașate aceleiași cereri

## Context
O cerere de document poate avea în prezent **un singur** fișier-model: coloanele `template_path`/`template_name` pe `activity_document_requirements`, respectiv `attachment_path`/`attachment_original_name` pe `template_document_requirements`.

## Cerință
- O cerere de document poate avea **mai multe fișiere-model sau exemple** atașate.
- Clientul poate deschide sau descărca **fiecare model separat**.
- Funcționează atât pentru cererile create **direct în proiect**, cât și pentru cele definite **în șablon**.

## Criterii de acceptare
- [ ] La crearea/editarea unei cereri (în proiect și în șablon) se pot atașa mai multe fișiere-model.
- [ ] Fișierele-model existente (câte unul per cerere) sunt migrate fără pierderi.
- [ ] Clientul vede lista modelelor și poate deschide/descărca fiecare separat.
- [ ] Importul de șablon în proiect copiază toate modelele.
- [ ] Propagarea modificărilor de șablon către proiecte funcționează cu mai multe atașamente.
- [ ] Mecanismul de detectare a atașamentelor lipsă (`attachment_missing_at`) funcționează per-atașament.

## Note tehnice
- **Cea mai invazivă schimbare de schemă din tot setul de cerințe** — de tratat cu atenție:
  - tabel copil nou (ex. `document_requirement_attachments`) pentru ambele entități (varianta proiect + varianta șablon), sau două tabele paralele;
  - migrare de date din coloanele actuale + păstrarea coloanelor vechi până la finalizarea tranziției (sau view de compatibilitate);
  - actualizarea logicii de propagare șablon → proiect și a PRD-ului de „stale attachment handling" (`docs/prd/`).
- Rutele afectate: `templates/attachment/init`, `templates/documents/attachment/init`, `projects/[id]/document-requests/attachment/init`, `document-requests/[requestId]/attachment/signed-download`, plus UI (`DocumentModal`, `DocumentRequests`, pagina de șabloane).

## Dependențe
- Migrarea SQL se grupează cu etapa de fundații (aplicare manuală — Sandu).
- De finalizat înaintea *Duplicării fazelor și activităților* (duplicarea trebuie să copieze toate atașamentele).
