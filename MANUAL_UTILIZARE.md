# Manual de Utilizare — Platforma Bonie

**Platforma Bonie** este un sistem de management al proiectelor de finanțare, destinat companiilor de consultanță și clienților acestora. Permite urmărirea proiectelor, gestionarea documentelor, coordonarea echipelor și monitorizarea progresului.

---

## Cuprins

1. [Roluri de utilizator](#1-roluri-de-utilizator)
2. [Autentificare](#2-autentificare)
3. [Administrator](#3-administrator)
4. [Consultant](#4-consultant)
5. [Client](#5-client)
6. [Fluxul unui document](#6-fluxul-unui-document)
7. [Glosar](#7-glosar)

---

## 1. Roluri de utilizator

Platforma are **3 roluri**:

| Rol | Descriere |
|-----|-----------|
| **Admin** | Acces complet. Creează proiecte, utilizatori, template-uri și statusuri. Vede tot. |
| **Consultant** | Gestionează proiectele la care este asignat. Solicită și verifică documente de la clienți. |
| **Client** | Vede propriile proiecte și încarcă documentele solicitate de consultant. |

---

## 2. Autentificare

**Toți utilizatorii** accesează platforma prin pagina de **Login** (`/login`).

- Se introduc **emailul** și **parola**
- Conturile sunt create exclusiv de Administrator
- După autentificare, fiecare utilizator este redirecționat automat la dashboard-ul corespunzător rolului său
- Deconectarea se face din butonul cu săgeată din colțul dreapta al barei de navigare

---

## 3. Administrator

Administratorul are acces la toate secțiunile platformei. Bara de navigare afișează: **Proiecte · Overview · Utilizatori · Audit**.

### 3.1 Gestionare Utilizatori (`/admin/users`)

**Cum se creează un utilizator nou:**

1. Selectează rolul dorit: **Client**, **Consultant** sau **Administrator**
2. Completează câmpurile obligatorii:
   - **Email** și **Parolă** (pentru toate rolurile)
   - **Nume complet**
   - **Telefon** (opțional)
3. Câmpuri suplimentare în funcție de rol:
   - **Client**: CIF firmă, Nume firmă, Adresă firmă, Persoană de contact
   - **Consultant**: Specializare, Departament
4. Apasă **Creează utilizator**

**Acțiuni posibile pe un utilizator existent:**
- Schimbarea rolului (din lista derulantă din dreptul utilizatorului)
- Ștergerea contului (buton Trash — necesită confirmare)

> **Atenție:** Ștergerea unui utilizator este ireversibilă.

---

### 3.2 Creare Proiect nou (`/projects/new`)

**Metoda 1 — Din Template** (recomandat):

1. Apasă **Proiect nou** din dashboard sau meniu
2. Completează:
   - **Titlu proiect**
   - **Client** (selectat din lista de clienți înregistrați)
   - **Email contact**, **Telefon contact**, **Persoană de contact** (opțional)
   - **Cod proiect** (opțional, codul oficial al finanțării)
3. Selectează un **template** din lista disponibilă — se vor preîncărca automat fazele, activitățile și documentele necesare
4. Apasă **Creează proiectul**

**Metoda 2 — Manual** (fără template):

1. Urmează pașii 1–3 de mai sus, dar alege **„Fără template"**
2. Adaugă manual fazele, activitățile și cerințele de documente

---

### 3.3 Gestionarea unui Proiect (`/projects/[id]`)

Pe pagina unui proiect administratorul poate:

**Editare titlu:** Apasă pictograma creion de lângă titlu → modifică → confirmare cu ✓

**Fazele proiectului (sidebar stânga):**
- Vizualizare faze și activități grupate pe status
- Adăugare faze noi cu butonul **+**
- Adăugare activități în cadrul unei faze
- Schimbarea statusului unei activități: `De făcut → În lucru → Gata / Blocat / Sărit`
- Asignarea unui consultant la o activitate
- Setarea unui deadline pe activitate

**Cereri de documente:**
- Butonul **Documente** (tab din dreapta) afișează toate cererile de documente ale proiectului
- Se pot adăuga cereri noi de documente pe o activitate
- Se pot seta termene limită și atașa un fișier template (model de document)
- Se pot asigna cereri unui consultant specific

**Echipa proiectului:**
- Secțiunea **Echipă** permite adăugarea/eliminarea consultanților din proiect

**Chat proiect:**
- Butonul **mesaj** (colțul dreapta) deschide chatul intern al proiectului
- Toți membrii proiectului (admin + consultanți) pot comunica în timp real
- Numărul de mesaje necitite apare ca badge pe buton

---

### 3.4 Template-uri (`/admin/templates`)

Template-urile definesc structura standard a unui proiect (faze → activități → documente necesare).

**Cum se creează un template:**

1. Apasă **Template nou**
2. Completează **Nume** și **Descriere**
3. Adaugă **faze**: fiecare fază se asociază cu un **Status de proiect** (ex: Contractare, Implementare)
4. În cadrul fiecărei faze, adaugă **activități**
5. Pentru fiecare activitate, adaugă **cerințe de documente**:
   - Bifează **Obligatoriu** dacă documentul este mandatory
   - Poți atașa un **fișier template** (model/formular)
   - Poți asigna un **consultant implicit** pentru activitate
6. Apasă **Salvează**

**Acțiuni pe un template existent:**
- Editare
- Duplicare (copiază structura complet)
- Ștergere

---

### 3.5 Statusuri Proiect (`/admin/statuses`)

Statusurile reprezintă etapele mari ale unui proiect (ex: *Contractare*, *Implementare*, *Monitorizare*).

**Cum se adaugă un status:**
1. Completează **Nume** și alege o **culoare**
2. Ordinea statusurilor se poate modifica prin drag & drop
3. Statusurile pot fi activate/dezactivate

---

### 3.6 Admin Overview (`/admin`)

Pagina de overview afișează:
- Numărul total de statusuri, template-uri, faze și activități configurate
- Lista vizuală a tuturor template-urilor cu fazele lor

---

### 3.7 Audit Log (`/admin/audit`)

Jurnalul de audit înregistrează **toate acțiunile** din platformă:
- Autentificări / deconectări
- Creare / modificare / ștergere: utilizatori, proiecte, documente, faze, activități

**Filtrare:** după tip acțiune, tip entitate, utilizator sau interval de date

---

## 4. Consultant

Consultantul vede în bara de navigare: **Proiecte**.

### 4.1 Dashboard — Proiectele mele

La autentificare, consultantul vede:
- **Statistici**: total proiecte, câte sunt în Contractare, câte în Implementare
- **Cereri de documente** — secțiune dedicată cu toate documentele solicitate de la clienți, cu urgența vizuală (culori)
- **Lista proiectelor** la care este asignat

### 4.2 Cereri de documente (`/my-requests`)

Aceasta este pagina principală de lucru a consultantului.

**Ce afișează:**
- Toate cererile de documente active pe proiectele sale
- Status fiecărei cereri: `Așteaptă · Verificare · Aprobat · Respins`
- Termenul limită cu cod de culoare:
  - **Roșu** = expirat
  - **Portocaliu** = scadent azi sau mâine
  - **Galben** = scadent în 3 zile
  - **Gri** = mai mult de o săptămână

**Acțiunea Reminder:**
- Butonul **Reminder** (Mail) generează un email pre-completat cu detaliile cererii, gata de trimis clientului
- Textul emailului se adaptează automat în funcție de urgența termenului:
  - *1 săptămână rămasă* → ton informativ
  - *3 zile rămase* → ton de alertă
  - *1 zi / azi* → ton urgent
- Butonul **Trimis?** marchează local remindere-ul ca trimis (cu data)

### 4.3 Gestionarea unui Proiect

Pe pagina unui proiect (`/projects/[id]`), consultantul poate:

**Faze și activități (sidebar):**
- Vede fazele și activitățile asignate lui
- Schimbă statusul activităților pe care le gestionează
- Adaugă note pe activități

**Documente:**
- Tab **Documente** → lista cererilor de documente ale proiectului
- **Adăugare cerere nouă**: buton **+** → completează Nume, Descriere, Deadline, dacă este obligatoriu → Salvează
- **Verificare document încărcat de client**:
  1. Apasă pe cererea de document
  2. Vizualizează fișierele încărcate
  3. Alege **Aprobă** sau **Respinge** (cu notă explicativă)
- **Descărcare fișier**: buton Download de lângă fiecare fișier
- **Fișier template**: dacă cererea are un model atașat, clientul îl poate descărca

**Chat:**
- Butonul de mesaj din colțul dreapta deschide chatul intern al proiectului

---

## 5. Client

Clientul vede în bara de navigare: **Proiecte**.

### 5.1 Dashboard

La autentificare, clientul vede **proiectele sale** sub formă de carduri cu:
- Titlul proiectului
- Statusul curent (ex: În Contractare, În Implementare)

### 5.2 Pagina unui Proiect

Clientul poate **vizualiza** progresul proiectului:
- Fazele și activitățile organizate pe etape
- Statusul fiecărei activități

**Încărcarea unui document solicitat:**

1. Apasă pe proiect → tab **Documente**
2. Localizează cererea de document cu statusul **„Așteaptă document"**
3. Apasă pe cerere pentru a o deschide
4. Dacă există un fișier template atașat, apasă **Descarcă model** pentru a-l completa
5. Apasă **Încarcă fișier** și selectează documentul de pe calculator
6. Fișierul poate fi un PDF, Word, Excel sau imagine
7. Apasă **Trimite** — statusul cererii devine **„În verificare"**

**Ce se întâmplă după încărcare:**
- Consultantul primește notificare
- Dacă documentul este **Aprobat** → statusul devine verde ✓
- Dacă documentul este **Respins** → consultantul lasă o notă explicativă → clientul poate încărca o versiune nouă

> Clientul **nu poate** crea proiecte, adăuga cereri de documente sau modifica structura proiectului.

---

## 6. Fluxul unui document

```
Consultant creează cerere
         ↓
    [Așteaptă document]
         ↓
Client încarcă fișierul
         ↓
    [În verificare]
         ↓
Consultant verifică
    ↙         ↘
[Aprobat]   [Respins]
                ↓
        Client reîncarcă
                ↓
        [În verificare]  → ...
```

**Statusuri posibile ale unui document:**

| Status | Culoare | Semnificație |
|--------|---------|--------------|
| Așteaptă document | Gri | Cererea a fost creată, clientul nu a încărcat încă |
| Încărcat | Albastru | Clientul a încărcat, consultantul nu a verificat |
| În verificare | Galben | Consultantul analizează documentul |
| Aprobat | Verde | Documentul a fost acceptat |
| Respins | Roșu | Documentul nu corespunde, clientul trebuie să reîncerce |

---

## 7. Glosar

| Termen | Definiție |
|--------|-----------|
| **Proiect** | Un proiect de finanțare al unui client, urmărit pe platformă |
| **Fază** | Etapă majoră a unui proiect (ex: Contractare, Implementare) |
| **Activitate** | Sarcină concretă în cadrul unei faze, asignată unui consultant |
| **Cerere de document** | Solicitare adresată clientului de a furniza un document specific |
| **Template** | Structură pre-definită de faze + activități + documente, reutilizabilă la crearea unui proiect |
| **Status proiect** | Etapa curentă a proiectului (definite de admin: Contractare, Implementare etc.) |
| **Reminder** | Email pre-completat pe care consultantul îl trimite clientului pentru a-l reaminti de un document |
| **Audit Log** | Jurnal complet al tuturor acțiunilor efectuate în platformă |
| **CIF** | Codul de identificare fiscală al firmei clientului |
| **Cod intern** | Identificator unic generat automat pentru fiecare proiect |

---
