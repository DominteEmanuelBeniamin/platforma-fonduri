# Issue-uri GitHub — Cerințe funcționale (draft local)

Draft-uri pentru issue-urile GitHub generate din documentul „Platforma Fonduri — Cerințe funcționale".
Publicarea restului se face cu `./create-issues.sh` (vezi jos).

**Publicate deja pe GitHub** (Etapa 1 — remedieri rapide; draft-urile au fost șterse de aici, conținutul e în issue):
[#44](https://github.com/DominteEmanuelBeniamin/platforma-fonduri/issues/44) bug cereri client (cerința 9) ·
[#45](https://github.com/DominteEmanuelBeniamin/platforma-fonduri/issues/45) preview în browser (cerința 17) ·
[#46](https://github.com/DominteEmanuelBeniamin/platforma-fonduri/issues/46) mesaje clare (cerința 5)

## Cerințe deja acoperite de issue-uri existente (nu se recreează)

| Cerință | Issue existent |
|---|---|
| 1. Reordonarea fazelor/activităților/cererilor — *în testare* | [#21](https://github.com/DominteEmanuelBeniamin/platforma-fonduri/issues/21) |
| 2. Trimiterea mai multor documente informative deodată — *în testare* | [#23](https://github.com/DominteEmanuelBeniamin/platforma-fonduri/issues/23) |

## Issue-uri de publicat (19)

| Cerință | Fișier | Etichete | Etapă propusă |
|---|---|---|---|
| 10 | `10-drepturi-noi-consultanti.md` | enhancement, security | **2 — Fundații** |
| 6 | `06-sabloane-ciorna-publicat.md` | enhancement | 2 — Fundații |
| 8 | `08-faze-activitati-in-pregatire-public.md` | enhancement, security | 2 — Fundații |
| 14 | `14-client-doar-ultima-versiune.md` | enhancement, security | 2 — Fundații |
| 18 | `18-mai-multe-fisiere-model-per-cerere.md` | enhancement | 2 — Fundații |
| 4 | `04-refacere-pagina-proiect.md` | enhancement, ux | **3 — Refacere UX** |
| 11 | `11-cautare-in-proiect-faze-pliabile.md` | enhancement, ux | 3 — Refacere UX |
| 12 | `12-calendar-pagina-proiect.md` | enhancement, ux | 3 — Refacere UX |
| 13 | `13-drive-dosare-per-faza.md` | enhancement, ux | 3 — Refacere UX |
| 3 | `03-refacere-pagina-home.md` | enhancement, ux | 3 — Refacere UX |
| 15 | `15-duplicare-faze-activitati.md` | enhancement | 3 — Refacere UX |
| 19 | `19-centru-unic-notificari.md` | enhancement | **4 — Notificări & calendar** |
| 7 | `07-email-direct-din-platforma.md` | enhancement | 4 — Notificări & calendar |
| 21 | `21-remindere-automate.md` | enhancement, infra | 4 — Notificări & calendar |
| 20 | `20-calendar-general-consultant.md` | enhancement | 4 — Notificări & calendar |
| 16 | `16-fisiere-atasate-in-chat.md` | enhancement | 4 — Notificări & calendar |
| 23 | `23-tablou-de-bord-admin.md` | enhancement, ux | 4 — Notificări & calendar |
| 24 | `24-ecran-centralizat-taskuri.md` | enhancement, ux | 4 — Notificări & calendar |
| 22 | `22-audit-complet.md` | enhancement, audit | **Transversal** (checklist pe fiecare PR) |

## Decizii de produs de clarificat înainte de implementare

1. **Termenul fazelor** (cerința 12): `project_phases` nu are coloană de deadline — se adaugă coloană sau se derivează din activități?
2. **TemplateSelector**: la creare proiect se oferă doar șabloanele publicate? — recomandare: da.
3. **Fișiere în chat**: și în chatul privat, sau doar în cel de proiect? — recomandare: ambele.
4. **Pragurile reminderelor automate**: 7/3/1 zile? Configurabile?
5. **„Consultantul responsabil"** (cerința 23): proiectele au echipă, nu un responsabil unic — se adaugă rol de responsabil pe proiect? — recomandare: da (ex. `is_lead` pe membru).
6. **„Task"** (cerința 24): doar activitățile, sau și cererile de documente cu termen? — recomandare: activitățile, cu filtru opțional pentru cereri.
7. **Starea implicită la creare** (cerința 8): elementele noi pornesc „În pregătire" sau „Public"? — recomandare: opțiune la creare, default „Public".
8. **Cine reordonează fazele** (cerințele 1 și 10) — propunere Gabriel: doar admin; cerința 10 dă dreptul și consultantului. De confirmat.
9. **Fișiere în chat vs zonă de schimb de documente** (cerința 16) — propunere Gabriel: fișierele merg într-o fază de schimb de documente, chatul primește doar link. De decis — schimbă scopul issue-ului.
10. **Forma calendarului** (cerința 12): tabel/listă vs Gantt — se decide pe macheta UX.

*Feedback-ul lui Gabriel Manole (15 iul 2026) a fost integrat în draft-urile: 03, 04, 07, 10, 11, 12, 16, 18, 19.*

*Rezolvate de versiunea actualizată (14 iul 2026) a documentului de cerințe:* În pregătire/Public se aplică și cererilor de documente (cerința 8); adminul are calendar general prin Tabloul de bord (cerința 23).

## Publicare (după aprobare)

```bash
cd docs/issues
./create-issues.sh          # creează etichetele lipsă + issue-urile nepublicate
```

Scriptul folosește `gh` (autentificat deja ca DominteEmanuelBeniamin). Etichete noi propuse: `ux`, `security`, `infra`, `audit`.
