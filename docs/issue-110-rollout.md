# Recepție și rollout #110

Faza 5 verifică sursele curente într-o bază temporară fără conturile sursă, cu Auth v2.197.0, REST, Storage, Realtime și Resend simulat. Nu aplică migrarea pe baza locală sursă sau hosted. Editorul complet al CIF-ului rămâne în #106.

Regresiile de interfață și proiect rulează pe `next build` / `next start` într-o copie a surselor, cu Turbopack ca în `npm run build`. Numai configurația copiei primește rădăcina workspace-ului pentru rezolvarea junction-ului `node_modules`; configurația aplicației sursă rămâne cea din repository. Proba HTTP de recovery folosește o a doua copie în development, pe aceeași bază izolată: #107 refuză intenționat HTTP și furnizorii simulați în producție. Gărzile aplicației rămân active; testarea HTTPS și livrabilitatea reală se recepționează în preview.

## Reproducere locală (PowerShell)

Docker și stack-ul Supabase local trebuie să fie pornite. `.env.e2e.localdb` trebuie să declare explicit `E2E_WRITES=1`, `E2E_TEST_PROJECT=1` și cheile stack-ului local. Nu folosi configurația hosted.

```powershell
npm.cmd run verifica
$env:E2E_ENV_FILE = '.env.e2e.localdb'
node --experimental-strip-types scripts/issue-110-phase0.mjs --phase5
node scripts/issue-110-phase4.mjs
```

Prima probă include verificările fazelor 0, 2 și 3, bootstrap-ul/seed-ul repetat și regresiile Playwright. [Raportul final de recepție](issue-110-phase5-acceptance-results.json) combină rularea completă cu reverificarea celor două matrice adaptate. Rapoartele brute `docs/issue-110-phase5-results.json` și `docs/issue-110-phase5-playwright-results.json` descriu ultima rulare și pot fi selective. Diagnosticul detaliat rămâne ignorat de Git în `playwright-report/issue110-phase5`; poate conține date de acces sintetice. Rapoartele vechi, rezultatele Playwright și copiile din `supabase/.temp` sunt excluse din TypeScript/lint; aplicația și testele din `tests/` sunt incluse.

## Când se testează manual

Consemnează rezultatele în [fișa de recepție manuală](issue-110-manual-reception.md). În prezent, probele umane sunt neexecutate; trecerea testelor automate nu le completează automat.

Recepția umană se face **după** trecerea verificărilor automate, pe calculator Windows și pe un telefon real. Pentru pregătirea aceluiași mediu temporar și păstrarea lui deschis:

```powershell
node --experimental-strip-types scripts/issue-110-phase0.mjs --phase5 --manual
```

Așteaptă mesajul `MANUAL_READY`. Deschide adresa indicată (implicit `http://127.0.0.1:3005`) și folosește `admin@test.local` / `Parola123!`. Procesul trebuie păstrat pornit; Ctrl+C închide mediul și curăță baza/containerele temporare. Pentru depanarea unei suite se poate seta `ISSUE110_SUITES` la o listă de nume separate prin virgulă; elimină această variabilă pentru recepția completă. `--phase5-only` omite repetarea probelor API/SQL anterioare și servește doar depanării.

1. Deschide „Adaugă utilizator” și verifică România implicită. Lipește CUI-ul sintetic `ro 0007.027.241.197` (canonic `RO7027241197`), creează un client cu email sintetic unic și confirmă afișarea rezultatului. Acest exemplu este separat de CIF-urile rezervate de probele automate. Datele de acces trebuie să apară numai în emailul capturat local; contul finalizat apare activ, fără eticheta „Creare incompletă”.
2. Încearcă `12345678`: mesajul indică CUI invalid, focusul revine la câmp și formularul rămâne completat. Corectează valoarea și verifică dispariția erorii.
3. Creează alt client cu același CIF ca la pasul 1: mesajul indică firma deja existentă, fără date despre titular; numele, emailul și celelalte câmpuri rămân completate. Dezactivează primul cont și confirmă că CIF-ul rămâne rezervat.
4. Schimbă țara păstrând textul. Pentru Franța, numărul sintetic `DE123456780` este valid ca format; contul se creează cu CIF `FRDE123456780`. Pentru România, aceeași intrare trebuie refuzată ca nepotrivire de țară. Nu interpreta formatul străin drept dovadă a existenței firmei.
5. Creează un consultant și un admin fără CIF. Schimbă rolul unui client în consultant și confirmă că CIF-ul istoric nu apare în fișă; verifică rezervarea lui printr-o a doua încercare de creare.
6. Folosește Tab/Shift+Tab, Escape și navigarea din tastatură. Pe telefon verifică lista de țări, tastatura pentru RO, vizibilitatea integrală a erorii, derularea și butoanele. Notează separat telefonul/browserul folosit.

Adresa loopback nu este accesibilă direct de pe un telefon fizic. Testul pe telefon real se face în preview-ul izolat configurat pentru recepție; nu expune automat serverul și Supabase-ul local în rețea. Emularea desktop/telefon din Playwright rămâne o verificare separată, deja automatizată. Pentru „Creare incompletă”, timeout, compensare eșuată și recovery folosește dovezile automate: nu provoca erori deliberate pe conturi reale.

### Citirea emailului simulat

Scriptul afișează `MANUAL_EMAIL_LOG` cu fișierul JSONL al rulării curente. Pentru mediul pregătit deja, calea este consemnată în fișa de recepție. Nu există un inbox real: mesajele sunt capturate exclusiv în acel fișier local. După crearea unui cont, înlocuiește calea și emailul sintetic în comanda PowerShell:

```powershell
$taskMailLog = '<calea afișată după MANUAL_EMAIL_LOG>'
$taskAccountEmail = 'receptie.client@example.invalid'
Get-Content -LiteralPath $taskMailLog |
  ForEach-Object { ConvertFrom-Json -InputObject $_ } |
  Where-Object { $_.path -eq '/emails' -and ([string]$_.body.text).Contains('Adresa de email: ' + $taskAccountEmail) } |
  Select-Object -Last 1 |
  ForEach-Object { $_.body.text }
```

Mesajul include parola temporară a contului sintetic. Folosește-o într-o fereastră privată pentru verificarea loginului și a schimbării obligatorii a parolei. Nu copia mesajul sau parola în Git ori în fișa de recepție. Înainte de oprirea mediului, închide filele aplicației de test.

## Preflight pentru datele existente

Inventarul inițial a găsit date care necesită corectare. Un raport local trecut nu autorizează activarea pe hosted. Repetă inventarul pe baza țintă, după oprirea efectivă a scrierilor de conturi din toate deployment-urile și toate căile administrative.

Într-o sesiune SQL privilegiată **read-only**, exportă privat un singur obiect JSON:

```sql
SELECT jsonb_build_object(
  'profiles', coalesce(jsonb_agg(jsonb_build_object('role', role, 'cif', cif) ORDER BY id), '[]'::jsonb),
  'fingerprint', md5(coalesce(jsonb_agg(jsonb_build_array(id, role, cif) ORDER BY id), '[]'::jsonb)::text)
) FROM public.profiles;
```

Nu pune snapshot-ul în Git. Validează-l local cu modulul TypeScript comun:

```powershell
node --experimental-strip-types scripts/issue-110-preflight.mjs <snapshot-privat.json>
```

Rezultatul trebuie să aibă `valid=true` și toate cele patru contoare zero. Numai atunci scriptul afișează amprenta necesară migrării. Corectează manual valorile invalide și duplicatele, pe baza documentelor firmei, cu dovada vechi/nou/autor în canalul administrativ. Nu deduce CIF-uri din numele firmei și nu muta automat proiecte sau fișiere. Reexportă și revalidează după orice corecție; un snapshot vechi nu mai poate fi folosit.

## Aplicare coordonată și reluarea scrierilor

Workflow-ul existent `.github/workflows/supabase-migrations.yml` rulează `supabase db push` automat la push pe `main`. Migrarea #110 cere amprenta validată în aceeași sesiune SQL; acel apel automat nu o setează și va fi refuzat de gardă. Înainte de integrarea pe `main`, echipa trebuie să coordoneze acest workflow cu aplicarea SQL și înregistrarea versiunii descrise mai jos. Validarea CI pe o bază nouă trebuie să pregătească explicit preflight-ul bazei de test. Nu elimina garda pentru a face pipeline-ul verde și nu considera un merge drept activare verificată.

1. Confirmă backup-ul, compatibilitatea reală Auth/#105/#107, recepția manuală în preview și pachetul aplicației noi. Pregătește restaurarea și păstrează scrierile oprite pe întreaga fereastră. Aplicația veche nu este compatibilă cu triggerul nou.
2. În **aceeași conexiune SQL** folosită pentru aplicarea migrației, setează amprenta verificată: `SET app.issue110_cif_preflight = '<amprenta-validată>';`, apoi execută integral `supabase/migrations/20261022112933_issue_110_cif_account_creation.sql`. Fișierul își deschide propria tranzacție și verifică amprenta sub blocare. Orice diferență, eroare de date sau timeout oprește operațiunea; nu ocoli garda.
3. Dacă aplici prin SQL direct, înregistrează apoi versiunea în istoricul migrărilor folosind fluxul CLI al echipei; consultă întâi `supabase migration repair --help` și verifică `migration list`. Nu reaplica fișierul și nu modifica migrările istorice.
4. Publică aplicația compatibilă înainte de reluarea scrierilor. Verifică `creation_pending`, constrângerile, indexul unic `profiles_cif_unique`, privilegiile funcțiilor service-role și advisorii. Pe hosted verifică separat setările și versiunea Auth; configurația Docker locală nu le dovedește.
5. Repetă preflight-ul și creează conturi controlate pentru toate cele trei roluri. Confirmă loginul și parola temporară, CIF-ul canonic, refuzul duplicatului și faptul că emailul pleacă numai după activare. Verifică livrarea reală Resend într-o adresă controlată; mock-ul local nu verifică livrabilitatea.
6. Reia scrierile numai după aceste verificări. Dacă apare un eșec, păstrează pending-urile blocate și remediază versiunea. Nu reactiva în masă, nu elimina indexul și nu reveni la crearea activă în doi pași. Folosește ștergerea protejată doar când serverul confirmă eligibilitatea.

Aplicarea hosted, corectarea datelor reale, deploy-ul și livrarea reală de email nu sunt executate de scripturile fazei 5.
