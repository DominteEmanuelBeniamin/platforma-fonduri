# Plan: schimbarea sigură a rolului în echipă

Data: 2 noiembrie 2026.
Stare: plan pentru implementare; acest document nu implementează modificările.

## 1. Obiectiv și decizia convenită

Păstrăm schimbarea rolului numai între administrator și consultant. Numai un
administrator activ o poate executa. Atât un consultant junior, cât și unul
senior poate deveni administrator; nivelul nu constituie singur un blocaj.

Conturile de client nu pot fi convertite în conturi interne și invers.
Editarea datelor unui client, inclusiv a firmei și CIF-ului, rămâne disponibilă
administratorului, independent de această restricție.

Prima fază oferă un inventar al impactului, linkuri către locurile de remediat
și blocarea confirmării până la rezolvarea responsabilităților incompatibile.
Înlocuirile sunt explicite, făcute individual din ecranele respective. Nu
implementăm transfer automat în masă și nu alegem înlocuitori în locul adminului.

## 2. Situația actuală, verificată în cod

- Lista utilizatorilor permite selectarea oricăruia dintre cele trei roluri.
  Cererea PATCH trimite în principal noul rol, fără un proces de predare.
- API-ul și `update_user_profile_guarded` permit tranziții către/de la client.
  Sunt validate în principal câmpurile trimise, nu profilul complet rezultat.
- Consultantul cere specializare; administratorul nu o cere. Numele complet,
  emailul, telefonul și departamentul sunt comune ambelor roluri.
- La ieșirea din rolul consultant, nivelul este resetat la junior. Revenirea
  nu trebuie să restabilească implicit privilegii senior.
- Schimbarea rolului păstrează atribuțiile, apartenențele la proiecte și
  consultantul implicit din șabloane.
- Accesul administratorului este general; consultantul accesează proiectele
  în care este membru. Promovarea nu echivalează cu predarea responsabilităților.
- Crearea unui proiect cere cel puțin un consultant senior activ, dar această
  condiție nu este protejată uniform la schimbarea rolului/nivelului,
  dezactivare sau eliminarea unui membru.
- Eliminarea din echipă are deja o gardă SQL pentru consultantul general,
  activități și cereri de documente. Ea verifică și atribuții care pot fi deja
  încheiate; nu poate fi reutilizată ca atare fără clasificarea istoricului.
- Proiectele încheiate refuză modificările obișnuite, inclusiv gestionarea echipei.
- Există deja protecții pentru ultimul administrator activ, conturile cu creare
  incompletă și mai multe operațiuni concurente, prin mecanismele #105.

Repere: `app/admin/users/page.tsx`, `components/UserProfileEditor.tsx`,
`app/api/users/[userId]/route.ts`, `lib/profile-edit.ts`,
`app/api/_utils/auth.ts`, `app/api/_utils/project-closure.ts`,
migrările `20261012100000`, `20261029130000`, `20261102090000` și rutele
pentru membri, activități, documente și șabloane.

## 3. Problemele rezolvate

1. Conturi transformate în client fără toate datele firmei sau transformate în
   consultant fără specializare.
2. CIF-uri și date de firmă ascunse în conturi interne după conversie.
3. Activități/cereri rămase atribuite unei persoane care nu mai este consultant.
4. Proiecte care pierd ultimul senior activ printr-o cale diferită de creare.
5. Șabloane care păstrează un consultant implicit devenit neeligibil.
6. Blocarea inutilă a schimbării rolului pentru acțiuni exclusiv istorice.
7. Confirmarea pe baza unui inventar învechit sau salvarea parțială a schimbării.
8. Blocaje fără ieșire la redeschiderea unui proiect încheiat.

Restricția nouă nu curăță automat datele create de conversii anterioare.
Conturile interne care au deja CIF sau sunt titulari de proiecte de client
se inventariază separat; nu ștergem valori și nu mutăm proiecte automat.

## 4. Reguli funcționale ale primei faze

### 4.1. Tranziții și datele profilului

| Operațiune | Regulă |
|---|---|
| Consultant junior/senior → admin | Permisă după rezolvarea blocajelor de responsabilitate |
| Admin → consultant | Cere specializare și alegerea nivelului; junior este preselectat |
| Client → alt rol / alt rol → client | Refuzată în UI, API și SQL |
| Junior ↔ senior | Rămâne acțiune distinctă, disponibilă doar adminilor |
| Editarea normală a profilului | Rămâne separată și numai pentru admini |

Numele complet, emailul, telefonul și departamentul se păstrează. Specializarea
veche se păstrează ca informație a persoanei, dar este ascunsă din editorul de
admin. La revenirea în consultant se precompletează și poate fi corectată.
Validarea folosește profilul final, cu aceleași cerințe ca la creare. Schimbarea
rolului nu trebuie să ceară schimbarea emailului sau a parolei.

Nu blocăm editarea obișnuită a unui nume/telefon doar pentru că există atribuții;
controalele de impact se execută când operațiunea afectează eligibilitatea sau
responsabilitățile. Datele obligatorii ale profilului curent rămân validate.

### 4.2. Inventarul și blocajele

Evaluăm starea rezultată după operațiune, nu doar rolul actual al persoanei.
Un înlocuitor trebuie să fie consultant activ, cu creare finalizată și membru
în proiect. Pentru supervizare este necesar un senior activ. Înlocuitorul
activităților poate fi diferit de seniorul proiectului.

| Referință | Tratament |
|---|---|
| Consultant general într-un proiect activ | Înlocuire obligatorie înainte de ieșirea din rolul consultant |
| Activitate neterminată din proiect activ, publicată | Înlocuire obligatorie; păstrăm publicarea, termenul și documentele |
| Activitate neterminată în ciornă | Înlocuire sau dezasignare explicită; la publicare trebuie din nou completată |
| Cerere de documente deschisă | Înlocuire obligatorie când responsabilitatea nu mai poate rămâne la persoana respectivă |
| Cerere cu fișiere care așteaptă verificarea | Nu dispare din inventar; se predă și responsabilitatea verificării |
| Ultimul senior activ al unui proiect activ | Se adaugă alt senior activ înainte de operațiune |
| Atribuire implicită în șablon utilizabil | Înlocuire sau eliminare explicită a atribuirii implicite |
| Membru simplu, fără atribuții și fără a fi ultimul senior | Informare; nu blochează singur schimbarea rolului |
| Lucrări încheiate și proiecte încheiate | Istoric; nu cer transfer în momentul schimbării rolului |
| Autor, verificator, persoana care a încheiat/încărcat ceva | Istoric; nu se rescrie |

Clasificarea trebuie să folosească stările existente din proiect, nu numele
vizibile în interfață. O activitate terminată care conține încă responsabilități
deschise nu exclude acele responsabilități din inventar. Referințele directe și
cele moștenite prin activitate/consultantul general se explică separat, fără
numărarea aceleiași responsabilități de mai multe ori.

Documentele șterse logic nu sunt sarcini curente. Un șablon neutilizabil poate
fi informativ, dar reactivarea/publicarea/importul lui trebuie să revalideze
atribuțiile. Nu schimbăm implicit versiunea, publicarea sau propagarea șablonului.

### 4.3. Seniorii, ultimul admin și accesul

- Într-un proiect activ trebuie să rămână cel puțin un consultant senior activ.
  Un administrator, chiar fost senior, nu este numărat ca senior al echipei.
- Aceeași regulă se aplică la consultant → admin, senior → junior,
  dezactivare și eliminarea membrului. Un alt senior dezactivat/pending nu ajută.
- Senior → junior nu transferă activitățile: persoana rămâne consultant eligibil,
  dar poate trebui adăugat alt senior în echipă.
- Nu impunem arbitrar un senior global dacă nu există proiecte afectate. Afișăm
  avertisment dacă dispar toți seniorii activi: crearea unui proiect nou cere
  alegerea unui supervizor valid.
- Protecția ultimului administrator activ rămâne obligatorie și tranzacțională.
- La schimbarea propriului rol, dacă există alt admin activ, salvarea poate
  reuși; apoi actualizăm profilul din interfață și redirecționăm în afara
  administrării. Drepturile sunt verificate pe server la fiecare operațiune.
- Admin → consultant nu adaugă automat persoana în toate proiectele. Dialogul
  explică accesul rezultat; echipa rămâne gestionată explicit.

Nu ștergem automat apartenențele vechi: rolul curent determină eligibilitatea,
interfața distinge membrii care nu mai sunt consultanți, iar revenirea în
consultant arată apartenențele care vor redeveni relevante. Atribuțiile active
incompatibile trebuie rezolvate indiferent de păstrarea apartenenței.

### 4.4. Redeschidere fără blocaj fără ieșire

Istoricul nu blochează promovarea, însă nu poate reactiva automat atribuții
invalide la redeschiderea unui proiect/faze/activități.

În prima fază includem o cale limitată de pregătire pentru admin: completarea
echipei și corectarea responsabililor necesari redeschiderii, prin controalele
manuale existente. Pentru un proiect încă încheiat, această excepție permite
strict aceste operațiuni, cu audit; titlul, lucrările, documentele și istoricul
rămân doar de citit. Nu relaxăm global garda pentru proiecte încheiate.

Redeschiderea verifică din nou seniorul activ și responsabilitățile care ar
redeveni curente. Aceleași verificări se aplică atunci când o activitate
terminată este redeschisă într-un proiect activ. Autorii finalizărilor și
verificărilor anterioare rămân neschimbați.

## 5. Ecranul de schimbare a rolului

Punct de pornire: pagina utilizatorului, cu acțiune explicită „Schimbă rolul”
pentru admini/consultanți. Lista utilizatorilor afișează rolul fără conversie
rapidă; pentru clienți nu există acțiune de schimbare a rolului.

Dialogul prezintă:

1. Persoana, rolul actual și rolul rezultat; explicația drepturilor schimbate.
2. Pentru admin → consultant: specializare și nivel junior/senior.
3. Blocaje grupate pe proiect și șablon, cu nume, tip, stare, număr și linkuri.
4. O explicație pentru fiecare blocaj: de exemplu „Adaugă alt senior activ”.
5. Referințe istorice și apartenențe păstrate, separat de blocaje.
6. „Reverifică” și data ultimei verificări; reîncărcare la revenirea după remedieri.
7. Confirmarea finală disponibilă numai după verificare reușită și zero blocaje.

Un link deschide locul de remediere fără pierderea datelor dialogului. În prima
fază nu salvăm reasignări din acest dialog și nu pornim operațiuni în masă.
Erorile de încărcare nu sunt echivalente cu „zero blocaje”. Listele mari se
paginează, păstrând totalurile complete și verificarea tuturor referințelor în DB.

## 6. Pașii tehnici, în ordinea implementării

### Pasul 1 — Definiții comune și inventar inițial

- Definim tranzițiile permise și cerințele profilului final.
- Stabilim predicatele pentru sarcini curente, istoric și senior eligibil,
  folosind regulile de lifecycle și publicare existente.
- Facem un inventar read-only al anomaliilor existente: proiecte fără senior,
  atribuții neeligibile, conturi interne cu date de client. Raportul nu repară date.
- Cazurile cu date vechi se afișează explicit; nu ascundem o problemă preexistentă
  și nu permitem operațiunii să producă o stare nouă incompatibilă.

### Pasul 2 — Inventarul de impact și contractul API

- Adăugăm o rută admin-only de impact pentru rol/nivel/dezactivare, cu ținta
  operațiunii explicită. Refolosim convențiile din `lifecycle-impact` unde se potrivesc.
- Rezultatul include blocaje, informări, totaluri și destinații de remediere.
- Nu expunem parole, chei, linkuri de recuperare sau conținutul fișierelor.
- Citirile sunt grupate; evităm o cerere per activitate/document.

### Pasul 3 — Migrare SQL și protecții la scriere

- Generăm migrare nouă cu CLI; nu modificăm migrările deja aplicate.
- Restricționăm schimbările efective de rol la admin ↔ consultant în funcția
  protejată. Retrimiterea aceluiași rol nu este o conversie către client.
- Validăm profilul complet rezultat și nivelul ales, nu numai câmpurile din PATCH.
- Introducem aceeași regulă a seniorului în schimbarea nivelului, dezactivare,
  eliminarea din echipă și operațiunile de redeschidere.
- Recalculăm impactul la confirmare, sub blocările potrivite și în ordinea
  compatibilă cu mecanismele #105. Și atribuirea unor sarcini noi trebuie să
  participe la protecție; simpla blocare a profilului nu dovedește siguranța.
- Un blocaj nou produce 409 și reîncărcarea impactului; nu schimbăm parțial rolul.
- Datele profilului, rolul/nivelul și auditul operațiunii reușite trebuie să fie
  coerente tranzacțional. Nu lăsăm o schimbare nereușită cu efecte secundare.

### Pasul 4 — Căile de remediere manuală

- Verificăm că fiecare blocaj are un ecran și o operațiune reală de rezolvare.
- Ajustăm eliminarea din echipă pentru a nu bloca exclusiv din cauza istoricului,
  fără a permite abandonarea lucrărilor curente.
- Asigurăm selecția înlocuitorilor eligibili și adăugarea lor explicită în echipă.
- Adăugăm pregătirea limitată a redeschiderii pentru proiectele încheiate.
- Nu republicăm activități și nu relansăm cereri/documente în urma reasignării.
  Notificările existente urmează reassignment-ul real, fără retrimitere la simpla
  încărcare a impactului sau la verificarea dialogului.

### Pasul 5 — Interfața și editarea profilului

- Înlocuim selectorul general de rol cu acțiunea din pagina utilizatorului.
- Implementăm dialogul de impact și câmpurile necesare revenirii în consultant.
- Păstrăm editorul de profil și validările CIF ale clientului; nu cerem CIF
  sau date de firmă pentru tranzițiile interne.
- Actualizăm numele rolului, meniurile și profilul sesiunii după confirmare.
- Tratăm explicit lipsa drepturilor, conturile pending, ultimul admin,
  blocajele noi și eșecul încărcării impactului.

### Pasul 6 — Teste și criterii de acceptare

| Grup | Cazuri obligatorii |
|---|---|
| Roluri | Ambele niveluri pot deveni admin; admin revine în junior/senior; conversiile client sunt refuzate inclusiv prin API/SQL |
| Profil | Specializare lipsă/blancă, date existente precompletate, nume/email obligatorii, editarea clientului rămâne funcțională |
| Sarcini | Publicate/ciornă, finalizate, document deschis/cu fișier de verificat/închis/șters logic, atribuiri moștenite |
| Seniori | Unicul senior, alt senior activ, alt senior inactiv/pending, junior înlocuitor insuficient, mai multe proiecte |
| Alte operațiuni | Retrogradare senior, dezactivare, eliminare membru și revenire în consultant |
| Istoric | Autorii, verificatorii, fișierele și finalizările nu sunt rescrise; proiect încheiat și redeschidere sigură |
| Șabloane | Implicit eligibil/neeligibil, înlocuire/eliminare explicită, reactivare și import |
| Concurență | Atribuire nouă după impact, doi seniori eliminați simultan, înlocuitor dezactivat, două acțiuni asupra ultimilor admini |
| Permisiuni | Numai admin activ, acces direct la endpointuri, schimbarea propriului rol și actualizarea interfeței |
| UX | Linkuri utile, totaluri corecte, zero blocaje real, eroare de încărcare, desktop, telefon și tastatură |

Executăm testele unitare relevante, probe SQL/API pe bază izolată și teste UI.
`npm run db:validate` trebuie să reconstruiască toate migrările. La final rulăm
verificările proiectului și urmărim check-urile PR-ului. Livrabilul include un
raport cu cazurile verificate și eventualele limitări, nu numai „testele trec”.

### Pasul 7 — Livrare și verificare după aplicare

- Publicăm schimbările într-un PR cu migrarea, API-ul și UI-ul compatibile.
- Confirmăm ordinea migrare/aplicație și compatibilitatea temporară: o versiune
  veche poate primi un refuz sigur, dar nu trebuie să poată ocoli regulile noi.
- Verificăm separat datele existente; nu includem curățări automate ale lor.
- Aplicarea în producție și orice remediere a datelor reale se fac în fluxul
  de deploy aprobat. Nu resetăm producția și nu transferăm automat atribuții.
- După deploy verificăm operațiunile permise, refuzurile și auditul; nu eliminăm
  protecțiile pentru a rezolva un cont blocat.

## 7. Ce NU intră în prima fază

- Conversii către/de la client sau migrarea unei firme pe alt cont.
- Transfer în masă din dialogul de rol sau alegerea automată a înlocuitorului.
- Ștergerea automată a CIF-urilor, datelor ascunse, apartenențelor sau istoricului.
- Roluri multiple simultane, precum „admin și consultant senior”.
- Promovarea automată a altui consultant pentru a elimina un blocaj.
- Un sistem nou de workflow, notificări sau aprobări.

## 8. Îmbunătățiri ulterioare, numai la decizia utilizatorului

1. Înlocuitor unic pe proiect, cu excepții per activitate/document și previzualizare.
2. Transfer în masă cu confirmare, audit complet, revalidare și reluare controlată.
3. Predarea coordonată a responsabilităților și schimbarea rolului într-o singură
   operațiune atomică, fără intervale cu responsabilitate neclară.
4. Un ecran dedicat „Predare responsabilități” pentru schimbare de rol,
   concediu, dezactivare sau plecarea din echipă.
5. Raport periodic al proiectelor fără senior și al atribuțiilor neeligibile,
   cu notificări numai la probleme noi sau nerezolvate relevante.
6. Roluri multiple sau separarea identității de persoană, firmă și rol operațional,
   numai dacă utilizarea reală justifică această schimbare de model.

Aceste îmbunătățiri nu sunt condiții ascunse ale primei faze și nu se implementează
fără o decizie ulterioară explicită.
