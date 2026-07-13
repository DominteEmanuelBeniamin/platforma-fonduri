# Issue-uri GitHub — Cerințe funcționale (draft local)

Draft-uri pentru issue-urile GitHub generate din documentul „Platforma Fonduri — Cerințe funcționale".
Publicarea restului se face cu `./create-issues.sh` (vezi jos).

**Publicate deja pe GitHub** (Etapa 1 — remedieri rapide):
[#44](https://github.com/DominteEmanuelBeniamin/platforma-fonduri/issues/44) bug cereri client ·
[#45](https://github.com/DominteEmanuelBeniamin/platforma-fonduri/issues/45) preview în browser ·
[#46](https://github.com/DominteEmanuelBeniamin/platforma-fonduri/issues/46) mesaje clare

## Cerințe deja acoperite de issue-uri existente (nu se recreează)

| Cerință | Issue existent |
|---|---|
| 1. Reordonarea fazelor/activităților/cererilor — *în testare* | [#21](https://github.com/DominteEmanuelBeniamin/platforma-fonduri/issues/21) |
| 2. Trimiterea mai multor documente informative deodată — *în testare* | [#23](https://github.com/DominteEmanuelBeniamin/platforma-fonduri/issues/23) |

## Issue-uri noi (20)

| Cerință | Fișier | Etichete | Etapă propusă |
|---|---|---|---|
| 9 | `09-bug-deschidere-cereri-client.md` | bug | **1 — Remedieri rapide** |
| 5 | `05-mesaje-clare-in-aplicatie.md` | enhancement, ux | 1 — Remedieri rapide |
| 17 | `17-preview-documente-in-browser.md` | enhancement, ux | 1 — Remedieri rapide |
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
| 22 | `22-audit-complet.md` | enhancement, audit | **Transversal** (checklist pe fiecare PR) |

## Decizii de produs de clarificat înainte de implementare

1. **Termenul fazelor** (cerința 12): `project_phases` nu are coloană de deadline — se adaugă coloană sau se derivează din activități?
2. **În pregătire/Public și pentru cererile de documente?** (întrebarea din cerința 8) — recomandare: da, prin moștenire + flag propriu.
3. **TemplateSelector**: la creare proiect se oferă doar șabloanele publicate? — recomandare: da.
4. **Fișiere în chat**: și în chatul privat, sau doar în cel de proiect? — recomandare: ambele.
5. **Pragurile reminderelor automate**: 7/3/1 zile? Configurabile?
6. **Calendar general și pentru admin** (toate proiectele)? — recomandare: da.

## Publicare (după aprobare)

```bash
cd docs/issues
./create-issues.sh          # creează etichetele lipsă + cele 20 de issue-uri
```

Scriptul folosește `gh` (autentificat deja ca DominteEmanuelBeniamin). Etichete noi propuse: `ux`, `security`, `infra`, `audit`.
