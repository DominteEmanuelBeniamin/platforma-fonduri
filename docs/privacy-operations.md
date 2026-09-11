# Checklist operațional pentru confidențialitate

Acest document este o listă de lucru internă. Pagina publică de confidențialitate nu este un certificat de conformitate și nu înlocuiește validarea juridică, tehnică sau contractuală.

## Înainte de producție

- [ ] Confirmați identitatea operatorului, adresa și canalul pentru cereri privind datele personale.
- [ ] Confirmați în scris rolurile: operator, operatori asociați (dacă există), persoane împuternicite și subîmputernicite. Nu presupuneți rolul doar din contractul cu furnizorul.
- [ ] Inventariați scopurile, categoriile de date și accesul pe roluri pentru conturi, proiecte, documente, chat, notificări și jurnale.
- [ ] Confirmați furnizorii, locațiile de prelucrare, subprocesatorii și existența/versiunea DPA pentru fiecare serviciu.
- [ ] Completați variabilele de mediu de mai jos și validați pagina în mediul de producție.
- [ ] Confirmați politica de retenție și tratamentul copiilor de siguranță; nu introduceți perioade în cod fără aprobare.

## Registrul furnizorilor și DPA

| Furnizor evidențiat în cod | Utilizare observată | De confirmat operațional |
| --- | --- | --- |
| Supabase | autentificare, bază de date, storage | rol, regiune, DPA, subprocesatori, backup și ștergere |
| Vercel | hosting, deployment și runtime | rol, regiune/loguri, DPA, retenție și ștergere |
| Resend | emailuri tranzacționale/notificări | rol, regiune, DPA, loguri și retenție |

Păstrați linkul/versiunea DPA și data verificării. Confirmați transferurile internaționale și mecanismul aplicabil înainte de utilizarea producției.

## Flux manual pentru cereri de drepturi (DSAR)

1. Primiți cererea prin `NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL` sau adresa configurată, notați data, solicitantul și domeniul cererii.
2. Verificați identitatea proporțional, fără a cere documente suplimentare dacă nu sunt necesare.
3. Înregistrați cererea într-un registru cu acces limitat și alocați un responsabil.
4. Căutați datele în Supabase Auth, baza de date, storage, exporturi/loguri relevante și la furnizorii implicați; marcați excepțiile, redacțiile și legal hold-ul.
5. Evaluați cererea cu responsabilul juridic/contractual și confirmați ce acțiuni sunt permise tehnic.
6. Răspundeți fără întârziere nejustificată, în principiu în termen de o lună; documentați orice prelungire, refuz, redacție sau imposibilitate.
7. Închideți cererea cu dovada răspunsului și acțiunile efectuate. Nu trimiteți parole sau secrete.

## Flux pentru incident / breșă

- [ ] Detectați, izolați și limitați accesul; nu ștergeți dovezile relevante.
- [ ] Escaladați către proprietarul aplicației, securitate și consilierul juridic desemnat.
- [ ] Stabiliți ce sisteme, categorii de date și persoane pot fi afectate; păstrați cronologia și deciziile.
- [ ] Verificați obligațiile și termenele de notificare aplicabile împreună cu responsabilul juridic; nu promiteți termene în interfață.
- [ ] Coordonați notificările către furnizori, clienți și autorități când evaluarea o cere.
- [ ] Documentați măsurile de containment, remediere și prevenire a repetării.

## Retenție, backup și legal hold

- [ ] Răspundeți explicit la întrebarea: ce copii de siguranță există la Supabase, Vercel și Resend, ce retenție au și când se propagă ștergerea?
- [ ] Confirmați cum funcționează restaurarea și cum sunt excluse datele șterse sau ținute sub legal hold.
- [ ] Definiți legal hold: cine îl poate plasa/ridica, motivul, domeniul, data, aprobarea și auditul; suspendați ștergerea cât timp este activ.
- [ ] Folosiți mecanismele acceptate de lucrarea separată de retenție: `projects.document_retention_until`, `projects.chat_retention_until`, `retention_basis`, `legal_hold_at`/`legal_hold_reason`, `document_requirements.retention_class`/`retention_until`/`purge_after`, `files.purge_after`, `messages.purge_after`, `retention_policies` și `data_deletion_jobs`.
- [ ] Tratați `NULL` sau `disabled` ca fail-closed: nu porniți purge-ul/ștergerea și escaladați configurația lipsă; aplicați legal hold-ul cât timp este activ.
- [ ] Pentru fiecare categorie (cont/profil, proiecte/documente, conversații, audit/notificări și backupuri), aprobați rezultatul: ștergere definitivă sau anonimizare ireversibilă.
- [ ] Pentru fiecare categorie, aprobați criteriul/termenul și perioada de grație; confirmați cum și când se propagă rezultatul în backupuri, inclusiv termenul furnizorului.

Notă: jobul zilnic purgează automat doar loturile de upload orfane eligibile; joburile de ștergere business ajunse la termen sunt doar inspectate și raportate pentru procesare manuală, fără execuție automată. Aceasta este limita de siguranță intenționată până la aprobarea deciziilor de retenție și a procesoarelor distructive.

Toate politicile inițializate sunt `disabled` și `NULL`. Rularea sigură se face în trei pași: (1) aprobați termenii, setați deadline-urile și duratele politicilor; (2) rulați și inspectați jobul în dry-run; (3) setați `DATA_RETENTION_DRY_RUN=false` numai pentru purge-ul loturilor de upload orfane implementat în prezent. `CRON_SECRET` este obligatoriu.

## Variabile obligatorii înainte de producție

Completați exact aceste valori în configurația de runtime; nu comiteți `.env.local` sau secrete:

- `NEXT_PUBLIC_PRIVACY_OPERATOR_NAME`
- `NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL`
- `NEXT_PUBLIC_PRIVACY_CONTACT_ADDRESS`
- `NEXT_PUBLIC_PRIVACY_SUPERVISORY_AUTHORITY_NAME`
- `NEXT_PUBLIC_PRIVACY_SUPERVISORY_AUTHORITY_URL` — trebuie să fie URL `http://` sau `https://` pentru a fi afișat ca link.

După completare, verificați manual pagina `/confidentialitate`, linkul din footer și linkul de pe autentificare.
