# Documente sensibile și copia zilnică a bazei

22 octombrie 2026. Parte din planul GDPR (pașii A06 și P03 din pagina „Planul GDPR Kabinet”, plus un înlocuitor gratuit pentru P04).

## Documente sensibile (copii de buletin, caziere)

**Ce face.** O cerere de document poate fi marcată „Date sensibile”, cu tipul *Act de identitate (CNP)* sau *Cazier judiciar*. Marcajul se pune în șablon (editorul de documente) sau direct pe cererea din proiect. Din șablon trece în proiect la creare, la import și la propagare. Propagarea doar adaugă marcajul, nu îl scoate niciodată.

- Pe rând și în fișa cererii apare eticheta „CNP” sau „Cazier”.
- Clientul vede la încărcare de ce i se cere documentul și când se șterge.
- Echipa vede în fișă data ștergerii automate.
- Adminul poate amâna ștergerea până la o dată aleasă, cu motiv scris; amânarea intră în jurnal. Merge și pe proiecte încheiate.

**Termenele** (în `lib/sensitive-documents.ts`, de confirmat cu avocatul):

| Tip | Se șterge |
|---|---|
| Cazier judiciar | la 90 de zile după aprobare, sau la 30 de zile după încheierea proiectului, care vine prima |
| Act de identitate | la 30 de zile după încheierea proiectului |

**Ștergerea.** Jobul `/api/cron/date-sensibile` rulează zilnic la 02:00 UTC. Pentru fiecare cerere ajunsă la termen face trei lucruri:
1. Șterge fișierele din storage (toate versiunile).
2. Înlocuiește în bază numele și căile fișierelor (de obicei conțin numele persoanei), apoi marchează cererea cu `sensitive_purged_at`.
3. Scrie în jurnal o intrare „Ștergere automată”.

Jurnalul de audit nu se modifică: e append-only, deci intrările vechi de la încărcare păstrează numele fișierelor.

**Pornit în simulare.** Fără variabila de mai jos, jobul doar numără ce ar șterge și nu atinge nimic. După ce avocatul confirmă termenele, în Vercel (proiectul documentebonie → Settings → Environment Variables, doar Production):

```
SENSITIVE_PURGE_ENABLED=true
```

Ca să vezi ce ar șterge înainte de pornire, rulează jobul manual și citește răspunsul (`due` = câte cereri au ajuns la termen):

```
curl -H "Authorization: Bearer $CRON_SECRET" https://www.kabinet.ro/api/cron/date-sensibile
```

## Copia zilnică a bazei

**De ce.** Supabase Free nu are backupuri. Până la Supabase Pro, jobul `/api/cron/copie-baza` (zilnic, 01:00 UTC) scrie toate tabelele din `public` și conturile din Auth (fără parole) într-un fișier NDJSON comprimat: `backups/db/kabinet-db-AAAA-LL-ZZ.ndjson.gz`. Păstrează 14 zile. Fiecare rulare scrie în jurnal o intrare „Copie a bazei”, cu numărul de rânduri; o rulare eșuată apare tot acolo.

**Ce nu acoperă.**
- Copia stă în același proiect Supabase: acoperă o ștergere sau o migrare greșită, nu pierderea proiectului.
- Fișierele încărcate nu intră în copie. Copia lor rămâne pasul P05 (Scaleway).
- Pe Free, un fișier încărcat are cel mult 50 MB; o bază mai mare are nevoie de Pro.

**Recuperare.** Descarcă fișierul zilei (Supabase → Storage → backups → db), apoi:

```
node scripts/copie-baza-citeste.mjs kabinet-db-2026-10-22.ndjson.gz
```

Rezultatul e un dosar cu câte un fișier JSON pe tabel, pentru recuperare manuală. Fișierele conțin date personale: ține-le pe un disc criptat și șterge-le după folosire.

## Regiunea funcțiilor

`vercel.json` setează `"regions": ["dub1"]` (Dublin, aceeași regiune AWS ca baza Supabase). Funcțiile și cron-urile nu mai rulează în Washington. Verificare după deploy:

```
curl -sI https://www.kabinet.ro/api/me | grep -i x-vercel-id   # trebuie să conțină ::dub1::
```

## Migrații

`20261022120000_date_sensibile.sql` și `20261022120100_copie_zilnica_baza.sql` sunt mai noi decât migrațiile din #123 și #124. Dacă branch-ul ăsta intră în `main` înaintea lor, migrațiile lor ajung „mai vechi decât producția”, iar `supabase db push --linked` le refuză. Fie intră #124 și #123 întâi, fie le redenumești migrațiile la merge.
