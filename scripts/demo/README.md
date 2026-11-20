# Popularea proiectului Supabase de demo

O singură comandă umple proiectul demo cu aceleași date ca în ghidul video: 6 conturi, 4 șabloane, 8 proiecte în stadii diferite, fișiere încărcate, documente aprobate/respinse și mesaje în chat.

Scriptul **refuză producția**: merge doar pe proiectul al cărui ID îl scrii în `.env.demo.local`.

## Ce se creează

| Rol | Email | Parola |
|---|---|---|
| Administrator | admin@test.local | ParolaDemo123! |
| Consultant senior | mihai.ionescu@test.local | ParolaDemo123! |
| Consultant junior | ana.popescu@test.local | ParolaDemo123! |
| Client — Agro Verde SRL | client.agroverde@test.local | ParolaDemo123! |
| Client — Brutăria Moldovei SRL | client.brutaria@test.local | ParolaDemo123! |
| Client — TechNord Solutions SRL | client.technord@test.local | ParolaDemo123! |

Proiecte: „Agro Verde — linie de procesare legume” (proiectul-vitrină, faza 1 în lucru), „Brutăria Moldovei — extindere capacitate de producție” (5 faze terminate), „TechNord — centru de producție imprimare 3D” (2 faze terminate), „Agro Verde — sistem de irigații” (încheiat) și 4 proiecte mai mici pe șabloanele Start-Up Nation și AFIR.

## Pasul 1 — Ia datele din Supabase

Deschide proiectul **demo** în [supabase.com/dashboard](https://supabase.com/dashboard) (atenție să nu fie cel de producție).

1. **Project Settings → General** → copiază **Project ID** (20 de litere, de ex. `abcdefghijklmnopqrst`).
2. **Project Settings → API Keys** → tab-ul **Legacy API Keys** → copiază **anon public** și **service_role** (la service_role apasă „Reveal”).
3. Butonul **Connect** (sus, în mijloc) → secțiunea **Session pooler** → copiază connection string-ul. Arată așa:
   `postgresql://postgres.abcdefghijklmnopqrst:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`
   **Lasă `[YOUR-PASSWORD]` exact așa.**
4. Parola bazei de date e cea aleasă la crearea proiectului. Dacă n-o mai știi: **Project Settings → Database → Reset database password**.

## Pasul 2 — Creează `.env.demo.local`

În folderul proiectului (lângă `package.json`) creează fișierul `.env.demo.local`:

```
DEMO_PROJECT_REF=abcdefghijklmnopqrst
NEXT_PUBLIC_SUPABASE_URL=https://abcdefghijklmnopqrst.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...anon...
SUPABASE_SERVICE_ROLE_KEY=eyJ...service_role...
DEMO_DB_URL=postgresql://postgres.abcdefghijklmnopqrst:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres
DEMO_DB_PASSWORD=parola-bazei-de-date
```

Fișierul nu ajunge în git (`.env*` e în `.gitignore`). Nu-l trimite nimănui: cheia service_role dă acces total la proiect.

## Pasul 3 — Rulează

Ai nevoie de Node 22.6 sau mai nou (`node -v`). Oprește `npm run dev`, dacă îl ai pornit, apoi:

```bash
npm install
npm run demo:populeaza
```

Durează în jur de 10 minute. Scriptul:

1. aplică migrările pe proiectul demo (`supabase db push`);
2. creează bucket-ul `project-files`, dacă nu există;
3. pornește aplicația local pe portul 3005, legată de proiectul demo;
4. creează conturile, șabloanele și proiectele;
5. încarcă fișiere, aprobă/respinge documente și scrie mesajele din chat;
6. oprește aplicația.

Nu pleacă niciun email: tot ce ar trimite aplicația ajunge în `playwright-report/demo-mail/resend.jsonl`.

La final apare „Gata. Proiectul demo e populat.” Dacă se oprește cu o eroare, trimite textul erorii (parola nu apare în el).

## Dacă îl rulezi din nou

Șabloanele și proiectele demo se șterg și se fac din nou, iar conturile rămân. Singurul lucru care se dublează e conversația privată dintre Mihai și Ana.

## Cum vezi demo-ul

Datele sunt în Supabase. Ca să le vezi în aplicație, aplicația trebuie să folosească proiectul demo:

- **pe calculatorul tău:** `npx next dev -p 3005` cu aceleași patru variabile `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_URL` (aceeași adresă) și `SUPABASE_SERVICE_ROLE_KEY` ale proiectului demo;
- **online:** un deploy Vercel separat, cu aceste variabile setate pe proiectul demo. **Nu modifica variabilele deploy-ului de producție.**
