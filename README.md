This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Database baseline

Migrările din repository sunt delta-uri aplicate peste schema Supabase existentă. `public.audit_logs` trebuie să existe înainte de migrările din 2026-05-26; validează schema reală cu `npm run audit:check`. O bază goală are nevoie de un baseline complet al întregii scheme, care nu se improvizează doar pentru audit. Nu există în repository un dump canonic publicat; acesta rămâne o datorie operațională.

## Teste de interfață

Suita nu scrie nimic în bază: se autentifică, deschide ecrane și măsoară ce se
vede. Are nevoie doar de `.env.e2e.local` (adresă + trei conturi) și de un
server pornit separat.

```bash
npm run dev              # într-un terminal
npm run test:ui          # desktop + telefon + tabletă
npm run test:ui:telefon  # doar aparatele cu ecran tactil
npm run test:ui:raport   # deschide raportul HTML al ultimei rulări
```

**De ce nu folosim `storageState`.** Tiparul recomandat de Playwright e o
autentificare în proiectul de `setup`, salvată pe disc și rejucată în restul
testelor. Aici nu ține, din cauza backendului: Supabase rotește refresh
token-ul, deci e de unică folosință. Primul test care îl consumă îl invalidează
pentru toate celelalte, iar clientul, când refresh-ul îi eșuează, se
deconectează în tăcere — pagina se randează normal, dar fiecare cerere de date
întoarce 401. Măsurat pe o rulare întreagă: 23 de teste picate cu 401, față de
unul singur cu formularul. Se completează formularul de fiecare dată.

**Trei aparate în rulajul implicit**, nu zece. Peste patru dispozitive câștigul
se plafonează, iar timpul de rulare nu — de aceea proiectele acoperă doar ce nu
ține de lățime (degetul, lipsa mausului, motorul), iar lățimile se mătură mult
mai ieftin din `tests/ui/adaptiv.spec.ts`: zece praguri într-un singur browser,
cu o singură autentificare.

| Proiect   | Aparat            | Ce prinde                                              |
|-----------|-------------------|--------------------------------------------------------|
| `desktop` | Chrome 1440×900   | tot, plus măturarea de lățimi                           |
| `telefon` | Pixel 7, 412px    | sertare, foi de jos, o singură coloană                  |
| `tableta` | iPad Mini, 768px  | ecran tactil **peste** pragurile `sm:`/`md:`            |
| `iphone`  | iPhone 14, WebKit | motorul real de pe iOS — vezi mai jos                   |

Tableta nu e o repetare a telefonului: la 768px aplicația trece la dimensiuni de
maus și ascunde acțiuni după `hover`, deși degetul e tot deget. Rulează doar
`mobil.spec.ts`, fiindcă restul ecranelor sunt deja măturate la lățimea asta.

### iOS

Pe iPhone *orice* browser e WebKit, iar `dvh`, `env(safe-area-inset-*)` și
`backdrop-blur` — toate trei folosite aici — se poartă altfel decât în Chromium.
Proiectul există, dar stă în spatele unui steag fiindcă pe Linux cere biblioteci
de sistem:

```bash
sudo npx playwright install-deps webkit
npm run test:ui:iphone
```

### Ce verifică suita de telefon

Partea de telefon stă în trei fișiere, fiindcă sunt trei feluri de întrebări.

**`mobil.spec.ts` — macheta și degetul.** Ținte de 44px (pragul din `DESIGN.md`,
nu cel de 24px al WCAG 2.5.8), câmpuri de cel puțin 16px — sub atât Safari de pe
iPhone mărește pagina la focus și n-o mai dă înapoi —, controale care nu se
ascund după `hover`, fâșia de navigare care derulează în ea însăși, sertarul de
faze, foaia de notificări, trecerea chatului de la listă la conversație. La
final, fiecare ecran din aplicație e trecut prin aceeași verificare de sănătate;
lista de rute e una singură (`RUTE_APLICATIE` din `helpers.ts`), împărțită cu
suita de design, ca o rută nouă să nu ajungă verificată doar pe desktop.

**`mobil-conditii.spec.ts` — condițiile de teren.** Restul suitei presupune un
telefon ideal: rețea de fibră, aparatul ținut drept, nicio tastatură pe ecran.
Aici se scot ipotezele una câte una — 3G limitat prin CDP, rețeaua căzută la
mijlocul unei navigări, rotirea făcută *în timpul* folosirii (inclusiv cu
sertarul deschis), tastatura care ia 45% din înălțime, spațierea de text cerută
de WCAG 1.4.12, `prefers-reduced-motion`, și o glisare adevărată cu degetul,
trimisă prin CDP — nu un `scrollBy` din JavaScript, care ar trece și pe o
suprafață cu `touch-action: none`.

**`mobil-acces.spec.ts` — catalogul WCAG, cu axe-core.** Regulile scrise de noi
acoperă doar ce ne-am amintit să scriem; axe aduce cealaltă jumătate (contrast,
nume accesibile, ordinea titlurilor, ARIA valid) pe nivelurile A și AA. Rulează
pe telefon fiindcă la 412px se randează alte componente decât pe desktop —
sertare, foi de jos, meniuri de acțiuni — cu propriile lor probleme de nume și
de rol. `target-size` e singura regulă exclusă, și doar pentru că pragul nostru
de 44px e mai strict decât al ei.

Emularea prinde așezarea și interacțiunea. Ce nu prinde: motorul de randare al
aparatului, stiva de rețea reală, GPU-ul. Recomandarea uzuală e ~80% emulare
(machetă, comportament adaptiv, fluxuri) și ~20% aparat adevărat (randarea
Safari, performanță) — la noi partea a doua e pasul de recepție din `PRODUCT.md`,
plus proiectul `iphone` de mai sus, care măcar aduce motorul WebKit.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
