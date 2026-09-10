# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Trei roluri, toate tratate ca utilizatori primari (confirmat de utilizator: „toți, practic"). Nicio experiență nu se sacrifică pentru alta.

- **Consultantul de fonduri** — utilizatorul zilnic. Lucrează simultan pe mai multe proiecte de finanțare, fiecare împărțit în faze și activități, cu cereri de documente către client și termene proprii. Are nevoie de densitate, scanabilitate și viteză: sidebar de faze, șabloane, căutare în proiect, calendar personal de termene.
- **Clientul beneficiar** — firma sau persoana care aplică la finanțare. Intră rar și punctual: încarcă documentele cerute, vede unde e proiectul. Nu cunoaște jargonul intern. Are nevoie de claritate, ghidare și zero ambiguitate. Vede doar ce e publicat, nu ce e în lucru.
- **Administratorul firmei** — supraveghere. Tablou de bord cu toate proiectele, stadiul și termenele; gestionează utilizatori, șabloane, statusuri și jurnalul de audit.

Utilizatorii lucrează pe Windows și pe telefon; ambele contează la recepție, iar verificarea pe telefon e un pas explicit de livrare.

## Product Purpose

Bonie ține evidența completă a unui proiect de finanțare, de la deschidere până la închidere: fazele și activitățile, documentele cerute de la client și versiunile lor, termenele, discuția și jurnalul de acțiuni. Succesul înseamnă că un consultant nu mai reconstituie starea unui proiect din inbox, Drive și WhatsApp, iar clientul știe fără să fie sunat ce document se așteaptă de la el și până când.

## Positioning

Un singur fir per proiect. Astăzi documentele, termenele și discuția stau împrăștiate în Drive, email și WhatsApp; Bonie le leagă pe toate de faza și cererea concretă, cu jurnal de audit — nimeni nu mai caută „ce versiune era bună". Diferența față de o unealtă generică de management de proiect nu e lista de task-uri, ci legătura document ↔ cerere ↔ fază ↔ termen ↔ istoric, păstrată într-un singur loc și auditabilă.

## Operating Context

- Un proiect se deschide de obicei dintr-un **șablon** de faze și activități, care codifică felul în care firma lucrează un tip de finanțare; fazele și activitățile se pot și duplica.
- Consultantul emite **cereri de documente** către client, cu fișiere-model atașate; clientul încarcă răspunsul, iar clientul vede întotdeauna doar ultima versiune a unui document (regulă de produs confirmată, nu limitare tehnică).
- Fazele și cererile pot fi ținute **în lucru (draft)** și ascunse din proiect, căutare, calendar și notificări până la publicare; publicarea trimite email clientului.
- **Drive-ul** proiectului organizează fișierele pe dosare, câte unul per fază. PDF-urile și imaginile se previzualizează în pagină; Word și Excel sunt doar descărcabile.
- **Termenele** apar în calendarul proiectului și în calendarul general al consultantului; o sarcină programată zilnică la 06:00 trimite remindere pe email.
- **Chatul de proiect** permite imagini și linkuri către documentele proiectului; restul fișierelor rămân în fluxurile lor dedicate. Există și chat privat între utilizatori.
- **Centrul de notificări** e unic pentru toate rolurile și acoperă evenimentele de la lansarea lui încolo, nu retroactiv.
- Fiecare acțiune relevantă se scrie din construcție în **jurnalul de audit**, care e append-only.
- Emailurile pleacă din platformă, de pe adresa firmei — nu din inboxul personal al consultantului.

## Capabilities and Constraints

**Stivă:** Next.js (App Router) + React + TypeScript + Tailwind v4, Supabase (bază de date, conturi, storage), Resend (email), Vercel (găzduire și cron). Radix UI pentru primitive, lucide-react pentru iconuri.

**Constrângeri tehnice reale, la 7 septembrie 2026:**
- Interfața e exclusiv în română, cu textele scrise direct în cod. Nu există infrastructură de i18n; internaționalizarea ar fi o lucrare separată.
- O singură temă, light mode forțat. Nu există dark mode și nu e cerut.
- Fonturi de sistem, deliberat: `next/font/google` a picat buildul când CDN-ul a răspuns 404. Nicio soluție de design nu are voie să reintroducă o dependență de rețea la build pentru fonturi.
- Vercel Hobby interzice folosirea comercială — condiție de trecut înainte de primul client real, nu îmbunătățire.
- Supabase Free: 500 MB bază, 1 GB fișiere (≈12 proiecte duse până la capăt), suspendare după 7 zile fără trafic, fără backup-uri.
- Resend Free: 100 de emailuri pe zi, expediate momentan de pe `notificari@vorbaretul.ro`, un domeniu pe care clienții nu-l recunosc. Domeniul firmei nu există încă.
- Nu există în repository un export complet al schemei bazei de date; migrațiile sunt delta-uri peste o schemă Supabase existentă. Fișierele de tipuri din repo nu sunt sursă de adevăr — schema reală se verifică în baza live.
- Cron-ul de remindere rulează o singură dată pe zi, la oră aproximativă (limită a planului Hobby).

**Decizii deschise, de nu inventat:**
- Numele produsului. În aplicație (titlu, navbar) e **Bonie**; documentele către client sunt intitulate „Platforma Fonduri". Care rămâne, și dacă cele două coexistă, nu e stabilit.
- Domeniul propriu și adresa de expeditor.

## Brand Commitments

- Numele afișat în aplicație este **Bonie** (`app/layout.tsx`, `components/Navbar.tsx`). Descrierea existentă: „Platformă premium de management proiecte".
- Nu există logo, marcă vizuală sau assets de brand. `public/` conține doar SVG-urile implicite din create-next-app.
- Limba produsului este româna, inclusiv diacriticele, în interfață și în emailuri.
- Nicio altă restricție de identitate nu a fost declarată obligatorie.

## Evidence on Hand

- `docs/plan-dezvoltare-platforma-fonduri.tex` și `docs/Platforma-Fonduri-Plan-de-dezvoltare.pdf` — planul de livrare pe 6 faze, cu cele 24 de cerințe numerotate și ce e deja livrat.
- `docs/Platforma-Fonduri-Cerinte-functionale.pdf` — cerințele funcționale.
- `docs/prd/` — 6 PRD-uri punctuale (propagarea șabloanelor, vizibilitatea motivului de respingere, uploadurile interne în cronologie, ștergerea cererilor, referințe expirate la atașamente, acoperirea jurnalului de audit).
- `docs/infrastructura-si-costuri.md` — costuri reale și limite ale planurilor, cu estimările marcate explicit ca estimări.
- `docs/pasii-urmatori.md` — ordinea lucrărilor rămase; refacerea UI/UX pe toată platforma e primul punct.
- `supabase/migrations/` — 35 de migrații, istoricul real al schemei.

**Absențe de respectat:** nu există clienți reali în producție, testimoniale, studii de caz, cifre de utilizare măsurate, preț sau licențiere. Nimic din acestea nu se fabrică în interfață sau în materiale.

## Product Principles

1. **Un singur loc pentru starea unui proiect.** Orice funcționalitate nouă se leagă de faza și cererea concretă; nimic nu trăiește doar în capul consultantului sau într-un alt canal.
2. **Clientul nu trebuie să știe cum funcționează platforma.** Ce i se cere, până când, și ce a trimis deja — explicit, fără jargon intern și fără versiuni concurente.
3. **Ce e în lucru nu se vede.** Draftul e invizibil consistent — în proiect, în căutare, în calendar, în notificări — până la publicare.
4. **Fiecare acțiune relevantă se poate reconstitui.** Jurnalul de audit se scrie din construcție, odată cu funcționalitatea, nu la final.
5. **Livrare completă sau deloc.** Fără controale duplicate și fără jumătăți de funcționalitate; o funcție care nu poate fi dusă până la capăt se scoate, nu se lasă pe jumătate.

## Accessibility & Inclusion

**WCAG 2.2 AA** este standardul obligatoriu, confirmat de utilizator, și devine criteriu de audit pentru refacerea UI/UX și pentru tot ce urmează. Motivul: platforma atinge finanțări publice, iar EN 301 549 impune acest nivel.

Consecințe concrete de respectat: contrast 4.5:1 pentru text și 3:1 pentru componente și grafică, target-uri de atingere de minimum 24×24 CSS px (2.5.8), focus vizibil și neobturat (2.4.11/2.4.12), navigare completă la tastatură, ajutor consecvent (3.2.6) și fără reintroducerea informației deja furnizate (3.3.7). Verificarea pe telefon e un pas explicit de recepție, nu opțional.
