---
name: Bonie
description: Programul de semnalizare — o platformă de management al proiectelor de finanțare care spune permanent unde ești, ce e aici și unde mergi.
colors:
  paper: "#F5F4F0"
  paper-sunk: "#EDEBE5"
  plate: "#FFFFFF"
  rule: "#D9D6CD"
  rule-strong: "#B4AFA2"
  ink: "#16181C"
  ink-soft: "#4A4F57"
  ink-faint: "#6B7079"
  accent: "#0E4C4A"
  accent-soft: "#E3ECEA"
  accent-ink: "#0A3937"
  band-1-petrol: "#0E4C4A"
  band-2-ocru: "#7A5B12"
  band-3-caramida: "#8E3B2A"
  band-4-pruna: "#5B3A63"
  band-5-masliniu: "#4A5A24"
  band-6-ardezie: "#2F4858"
  ok: "#1F6B3A"
  ok-soft: "#E4EFE8"
  warn: "#8A5A08"
  warn-soft: "#F4EBDC"
  danger: "#9B2C21"
  danger-soft: "#F5E4E1"
  draft: "#6B7079"
  draft-soft: "#EAE9E5"
typography:
  display:
    fontFamily: "Atkinson Hyperlegible Next, system-ui, Segoe UI, sans-serif"
    fontSize: "clamp(1.875rem, 4vw, 2.25rem)"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  heading:
    fontFamily: "Atkinson Hyperlegible Next, system-ui, Segoe UI, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 700
    lineHeight: 1.35
    letterSpacing: "normal"
  body:
    fontFamily: "Atkinson Hyperlegible Next, system-ui, Segoe UI, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  label:
    fontFamily: "Atkinson Hyperlegible Next, system-ui, Segoe UI, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "normal"
rounded:
  plate: "2px"
  plate-lg: "3px"
  hair: "1px"
spacing:
  rail: "4px"
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "40px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "#FFFFFF"
    rounded: "{rounded.plate}"
    padding: "0 16px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.accent-ink}"
    textColor: "#FFFFFF"
  button-secondary:
    backgroundColor: "{colors.plate}"
    textColor: "{colors.ink}"
    rounded: "{rounded.plate}"
    padding: "0 16px"
    height: "44px"
  button-secondary-hover:
    backgroundColor: "{colors.paper-sunk}"
    textColor: "{colors.ink}"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.plate}"
    padding: "0 16px"
    height: "44px"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "#FFFFFF"
    rounded: "{rounded.plate}"
    padding: "0 16px"
    height: "44px"
  plate:
    backgroundColor: "{colors.plate}"
    textColor: "{colors.ink}"
    rounded: "{rounded.plate}"
    padding: "20px"
  plate-draft:
    backgroundColor: "transparent"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.plate}"
    padding: "20px"
  input:
    backgroundColor: "{colors.plate}"
    textColor: "{colors.ink}"
    rounded: "{rounded.plate}"
    padding: "0 12px"
    height: "44px"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.ink-soft}"
    rounded: "0"
    padding: "0 16px"
    height: "44px"
  nav-item-active:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent-ink}"
  signal-ok:
    backgroundColor: "{colors.ok-soft}"
    textColor: "{colors.ok}"
    rounded: "{rounded.plate}"
    padding: "2px 8px"
  signal-warn:
    backgroundColor: "{colors.warn-soft}"
    textColor: "{colors.warn}"
    rounded: "{rounded.plate}"
    padding: "2px 8px"
  signal-danger:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.danger}"
    rounded: "{rounded.plate}"
    padding: "2px 8px"
  signal-draft:
    backgroundColor: "{colors.draft-soft}"
    textColor: "{colors.draft}"
    rounded: "{rounded.plate}"
    padding: "2px 8px"
---

# Bonie — programul de semnalizare

## Overview

Bonie e sistemul de orientare al unei instituții bine ținute, tradus în interfață. Nu panoul de bord al unei aplicații SaaS, ci programul de semnalizare al unei clădiri: panoul-director din hol, banda de culoare pe etaj, plăcuța de pe ușă, săgeata. Un sistem de semnalizare bun răspunde permanent la trei întrebări, exact cele pe care un consultant cu opt proiecte deschise și un client care nu știe jargonul le pun de zeci de ori pe zi: **unde sunt, ce e aici, unde merg mai departe.**

Traducerea e literală, nu metaforică. Home e panoul-director. Un proiect e un etaj. O fază e o aripă și își poartă banda de culoare oriunde apare — în sidebar, în calendar, pe dosarul din Drive, în notificare. O activitate sau o cerere de documente e o plăcuță pe ușă. Jurnalul de audit e registrul de la intrare.

Ce refuză sistemul: grila de carduri egale cu umbră moale, panoul de metrici mari, eticheta mică tracked deasupra titlului. Un semn nu are umbră și nu plutește — e o bucată dreaptă de material prinsă pe perete.

Riscul asumat: un program instituțional poate aluneca în „portal guvernamental”, adică exact birocrația de care produsul trebuie să te scape. Trece doar executat cu disciplina semnalizării bune — spațiu generos, puține culori, tipografie perfectă.

## Colors

**Materialul.** `paper` #F5F4F0 e peretele; `plate` alb e fața plăcuței; `paper-sunk` e nișa, pentru rânduri alternate și zone inactive. `rule` și `rule-strong` sunt liniile — separatorul subțire și muchia unui câmp sau a unei plăcuțe apăsate.

**Cerneala, măsurată pe hârtie.** `ink` 16,15:1 · `ink-soft` 7,49:1 · `ink-faint` 4,52:1. `ink-faint` e pragul, nu o sugestie: sub el nu coboară niciun text.

**Accentul** e petrolul instituțional `#0E4C4A`. Alb pe el: 9,76:1. Nu e albastrul UE și nu e indigo-ul de SaaS.

**Cele șase benzi de fază** sunt fixe și ordonate: petrol, ocru, cărămidă, prună, măsliniu, ardezie. Se atribuie după **poziția fazei în proiect** (`bandFor(index)` în `lib/signage.ts`), ca într-un program de semnalizare adevărat, unde culorile aripilor sunt poziționale. Rotația pe șase dă distribuție egală și garantează că două faze vecine nu poartă niciodată aceeași culoare. Varianta pe id — un hash — a fost măsurată și respinsă: pe 14 faze dădea în medie 2,3 perechi de vecini identici și o distribuție strâmbă, adică exact opusul tezei. `bandFor(string)` rămâne pentru suprafețele care n-au poziția la îndemână. Fiecare bandă poartă text alb la ≥6,3:1 și se citește pe hârtie la ≥5,7:1.

**Semnalele sunt rezervate.** `ok` verde pentru finalizat, `warn` chihlimbar pentru termen apropiat, `danger` roșu pentru depășit, respins sau eroare, `draft` gri pentru nepublicat. Niciuna nu se folosește vreodată ca accent de brand. Roșul înseamnă că ceva arde — mesajele necitite nu ard, ele primesc accentul.

**A doua regulă, la fel de tare: o clasificare nu e un semnal.** Rolul unui utilizator, tipul unei cerințe și pragul unui reminder sunt categorii, nu stări — nu ard nimic. Nu primesc verde, chihlimbar sau roșu; se disting prin greutate, muchie și cuvânt. Semnalele rămân rezervate pentru ce se întâmplă cu munca: termen depășit, document respins, fază finalizată. Trei locuri le încălcau (rolurile în pagina de utilizatori, „Obligatoriu” pe cereri, pragurile de reminder) și toate trei au fost aduse la regulă.

**Regula care nu se încalcă:** culoarea nu poartă niciodată singură informația. O stare are culoare, **iconiță desenată** și cuvânt. `TONE` din `lib/signage.ts` dă culoarea, `ToneIcon` dă semnul, iar eticheta dă cuvântul. Iconițele vin din lucide, cu aceeași grosime de linie — niciodată o glifă de text pusă să pară iconiță, fiindcă o plăcuță fără semn se citește drept „nimic aici”.

## Typography

O singură familie în toată clădirea — așa lucrează un program de semnalizare adevărat. **Atkinson Hyperlegible Next**, desenată de Braille Institute anume ca `1/I/l` și `0/O` să nu se confunde. Motivul nu e estetic: platforma e plină de numere de proiect, coduri interne și termene care se citesc dintr-o privire, iar WCAG 2.2 AA e obligatoriu aici.

Găzduită local, în `app/fonts/`, prin `next/font/local`. Două subseturi, 53 KB: `latin` aduce î â, `latin-ext` aduce ș ț ă. **Nimic nu atinge rețeaua la build** — `next/font/google` a oprit odată livrarea când CDN-ul a răspuns 404, iar asta e o constrângere permanentă.

Cifre tabulare peste tot, activate pe `body`. Într-un sistem de semnalizare, numărul e informație, nu text — se aliniază pe coloană.

Scara: display 1,875–2,25rem/700 pentru titlul paginii · heading 1,125rem/700 pentru titlul unei plăcuțe · body 0,875rem/400 · label 0,75rem/600. Măsura textului de citit stă între 52 și 75 de caractere.

## Layout

Un singur container: `max-w-[1400px]`, cu `px-4 / sm:px-6 / lg:px-10`. Modulul de spațiere e 4px.

Ordinea verticală a fiecărui ecran e fixă și nu se negociază: **fâșia de locație** sus, apoi titlul, apoi bara de unelte, apoi conținutul. Fâșia de locație e primul lucru de pe pagină pentru că e răspunsul la prima întrebare.

Pe telefon, bara de unelte se rupe în rânduri, iar plăcuțele trec pe o coloană. Nimic nu se ascunde în spatele unui meniu hamburger — graful complet al fazelor rămâne vizibil la orice lățime. Corpul paginii nu derulează niciodată orizontal; ce e prea lat derulează în propriul container.

## Elevation & Depth

**Nu există umbre pe perete.** Adâncimea vine din linii și din material: o plăcuță se distinge prin muchia ei și prin fața albă pe hârtie, nu printr-un halo.

Singura umbră din sistem e `--sg-lift`, și aparține exclusiv lucrurilor care chiar plutesc peste perete: dialoguri, sertare, meniuri deschise. Are decalaj și estompare reale — `0 8px 24px -6px` plus `0 2px 6px -2px`. Un halo colorat fără decalaj e decor, nu adâncime, și nu intră aici.

## Shapes

Semnalizarea e dreaptă. `plate` 2px, `plate-lg` 3px pentru suprafețele care plutesc, `1px` pentru pătrățelele mici — bifă, contor, pastilă de ton. Nimic nu e rotund în afară de bara de derulare.

Banda de fază e o **fâșie plină de 4px pe muchia de sus** a plăcuței. Niciodată un `border-left` colorat: acela e tiparul leneș pe care sistemul îl refuză explicit.

Plăcuța nemontată — starea „în lucru” — are contur întrerupt, fond transparent și nicio bandă. Se citește imediat ca ceva ce încă nu e prins pe perete.

## Components

**Plăcuța** (`components/ui/Plate.tsx`) e unitatea de conținut. Acceptă `band` (faza) sau `rail` (un semnal, care are întâietate), `draft`, `interactive` și `selected`.

**Semnalul** (`components/ui/Signal.tsx`) e plăcuța de stare: culoare, iconiță și cuvânt, întotdeauna toate trei. **ToneIcon** (`components/ui/ToneIcon.tsx`) ține corespondența: triunghi pentru depășit sau respins, ochi pentru „de verificat”, ceas pentru „la client”, bifă pentru aprobat, peniță pentru „în lucru”.

**Butonul** (`components/ui/Button.tsx`) are patru variante — primary, secondary, quiet, danger — și două dimensiuni. Înălțimea minimă e 44px pe aparatele fără maus și 40px acolo unde există cursor: peste minimul de 24×24 al WCAG 2.5.8, pentru că acolo lucrează degetul. Pragul e `pointer: coarse`, nu o lățime — o tabletă de 768px n-are maus, dar trece de orice breakpoint pe care l-am folosi ca înlocuitor.

**Fâșia de locație** (`components/ui/LocationStrip.tsx`) e interacțiunea-semnătură. Un `<nav aria-label="Locație">` cu segmente ordonate, ultimul purtând `aria-current="page"`, plus acțiunea primară la dreapta. `Alt+L` o focalizează de oriunde din pagină; de acolo Tab parcurge etajele fără mouse. Folosește modificator, deci nu încalcă WCAG 2.1.4.

**Ecranul gol** (`components/ui/EmptyState.tsx`) spune ce lipsește și ce urmează. Fără ilustrație și fără glumă.

**Navigarea** e o fâșie de material cu o linie sub ea. Etajul curent poartă banda accentului dedesubt și fondul `accent-soft`. Fără pastile, fără sticlă mată.

**Focusul** e definit o singură dată, global, în `globals.css`: contur solid de 2px în accent, cu decalaj de 2px ca să nu fie acoperit (WCAG 2.4.11). Pe fond închis trece pe culoarea hârtiei. Nu se suprimă nicăieri.

**Suprafețele browserului** aparțin sistemului: selecția, cursorul, bara de derulare, decalajul sublinierii și autofill-ul sunt toate temate din paletă.

## Do's and Don'ts

**Do**
- Pornește orice ecran cu fâșia de locație, apoi titlul, apoi uneltele, apoi conținutul.
- Ia banda unei faze din `bandFor(poziția ei)`. Niciodată o culoare aleasă de mână.
- Pune întotdeauna cuvântul și iconița lângă culoare. `Signal` și `ToneIcon` fac asta din construcție; folosește-le în loc să desenezi o pastilă nouă.
- Măsoară contrastul înainte să adaugi o culoare. Pragurile sunt 4,5:1 pentru text și 3:1 pentru componente.
- Ținte de atingere de 44px pe telefon.
- Scrie fiecare stare: repaus, hover, focus-visible, activ, selectat, dezactivat, în încărcare, gol, eroare, în lucru, depășit. Niciuna nu se lasă pe seama implicitului Tailwind.

**Don't**
- Fără umbre pe plăcuțe. `--sg-lift` e doar pentru dialoguri, sertare și meniuri.
- Fără `border-left` colorat pe carduri, rânduri sau alerte. Banda stă sus.
- Fără etichetă mică tracked deasupra unui titlu. Titlul se descurcă singur.
- Fără nuanțe din afara paletei. Cele opt culori rătăcite din vechiul cod — purple, violet, rose, sky, blue, cyan, orange — nu se întorc.
- Fără roșu pentru altceva decât ce chiar arde.
- Fără culoare de semnal pe o clasificare: rol, tip de cerință, prag de reminder.
- Fără `next/font/google` și fără nicio dependență de rețea la build pentru fonturi.
- Fără glife de text (`✓`, `!`, `×`) folosite ca iconițe. Se desenează, din lucide, cu aceeași grosime de linie.
- Fără colț rotund mai mare de 3px, în afara barei de derulare.
