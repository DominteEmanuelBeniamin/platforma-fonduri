# Fișă de recepție manuală #110

Stare: **neexecutată**. Testarea manuală este amânată la cererea utilizatorului; faza 5 este implementată, fără activare hosted. Această fișă se completează după parcurgerea [instrucțiunilor de recepție și rollout](issue-110-rollout.md).

## Dovezi automate

[Raportul final](issue-110-phase5-acceptance-results.json) consemnează 427/427 teste unitare, 122/122 cazuri Playwright din 10 suite și 66/66 verificări de acceptare. Buildul, TypeScript și lint au trecut; rămân trei avertismente lint existente. Raportul combină rularea completă cu reverificarea celor două matrice adaptate și nu dovedește recepția umană sau livrarea reală de email.

## Mediul local pregătit

Verificat la 22 octombrie 2026: pagina de login răspunde HTTP 200, administratorul demo este activ și finalizat, iar CIF-urile sintetice de mai jos sunt disponibile. Baza locală sursă nu are migrarea #110 aplicată.

- Adresă: <http://127.0.0.1:3005/login>.
- Cont sintetic: `admin@test.local` / `Parola123!`.
- Bază temporară: `issue110_phase5_d48169d2e1d2`.
- Emailuri simulate: `supabase/.temp/issue110-d48169d2e1d2/resend.jsonl`.

Adresa funcționează cât timp procesul de recepție și Docker rămân pornite. La relansare, baza și calea emailurilor se schimbă; folosește valorile afișate de script. Comanda completă de recreare este în ghidul de rollout. Nu rula recepția pe aplicația conectată la baza sursă nemigrată.

## Rezultatele de completat

Tester: —. Data: —. Windows/browser: —. Telefon/browser: —. Adresă preview: —. Versiune testată: —.

Pentru fiecare probă folosește `Trecut`, `Eșuat` sau `Neexecutat` și notează observațiile. Conturile și datele sunt sintetice; nu copia parolele temporare sau mesajele brute în această fișă.

| Probă | Rezultat așteptat | Stare | Observații |
| --- | --- | --- | --- |
| Client RO | România implicită; `ro 0007.027.241.197` se salvează ca `RO7027241197`; cont activ, fără „Creare incompletă”. | Neexecutat | —|
| CUI greșit | `12345678` este refuzat cu mesaj clar; focus la câmp, formularul rămâne completat; corectarea permite continuarea. | Neexecutat | — |
| Duplicat | Alt email cu același CIF este refuzat, fără datele titularului; formularul rămâne completat. | Neexecutat | — |
| Client dezactivat | După dezactivare, CIF-ul rămâne rezervat. | Neexecutat | — |
| Număr FR | Cu Franța selectată, `DE123456780` se salvează ca `FRDE123456780`; cu România selectată este refuzat ca nepotrivire de țară. | Neexecutat | — |
| Celelalte roluri | Consultantul și adminul se creează fără CIF. | Neexecutat | — |
| CIF istoric | Un client fără date legate poate deveni consultant; CIF-ul nu se afișează, dar rămâne rezervat. | Neexecutat | — |
| Parola temporară | Emailul simulat corespunde contului creat; loginul cu parola din mesaj cere schimbarea parolei. | Neexecutat | — |
| Tastatură pe Windows | Tab/Shift+Tab, focus vizibil, Escape și selectarea țării funcționează; mesajele și butoanele rămân accesibile. | Neexecutat | — |
| Telefon fizic | În preview: selectarea țării, tastatura RO, mesajele complete, derularea și butoanele funcționează. | Neexecutat | — |
| Email real și HTTPS | În preview configurat: livrarea Resend la o adresă controlată și autentificarea prin HTTPS funcționează. | Neexecutat | — |

Telefonul fizic și emailul real necesită preview configurat separat. Loopback-ul local și Resend simulat nu verifică aceste două probe. Editorul complet din #106 se recepționează separat; această fișă nu declară implementarea lui.

## Verdict

Verdict: **în așteptare**. Probleme găsite: —. Reverificări necesare: —.

Recepția poate fi închisă după consemnarea rezultatelor și rezolvarea problemelor. Activarea hosted necesită separat preflight-ul pe datele reale și pașii coordonați din ghidul de rollout.
