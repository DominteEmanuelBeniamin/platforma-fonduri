import type { Metadata } from 'next'
import Link from 'next/link'
import { privacyOperator } from '@/lib/privacy-operator'
import { CAZIER_DAYS_AFTER_APPROVAL, DAYS_AFTER_PROJECT_CLOSURE } from '@/lib/sensitive-documents'
import { BACKUP_RETENTION_DAYS } from '@/lib/db-backup'

export const metadata: Metadata = {
  title: 'Politică de confidențialitate',
  description: 'Informații privind prelucrarea datelor cu caracter personal în platforma Bonie.',
}

const LAST_UPDATED = 'octombrie 2026'

const SECTIONS = [
  { id: 'informatii-generale', numeral: 'I', title: 'Informații generale' },
  { id: 'calitatea', numeral: 'II', title: 'Calitatea în care prelucrăm datele' },
  { id: 'categorii', numeral: 'III', title: 'Categoriile de date cu caracter personal prelucrate' },
  { id: 'scopuri', numeral: 'IV', title: 'Scopurile și temeiurile prelucrării' },
  { id: 'sensibile', numeral: 'V', title: 'Date cu caracter special' },
  { id: 'durata', numeral: 'VI', title: 'Durata pentru care vă prelucrăm datele' },
  { id: 'dezvaluire', numeral: 'VII', title: 'Cine are acces la date' },
  { id: 'transfer', numeral: 'VIII', title: 'Transferul datelor cu caracter personal' },
  { id: 'securitate', numeral: 'IX', title: 'Securitatea datelor' },
  { id: 'drepturi', numeral: 'X', title: 'Drepturile de care beneficiați' },
  { id: 'cookie-uri', numeral: 'XI', title: 'Cookie-uri' },
  { id: 'modificari', numeral: 'XII', title: 'Modificarea politicii' },
] as const

function Missing({ what }: { what: string }) {
  return <span className="rounded-[var(--radius-plate)] bg-[var(--sg-warn-soft)] px-1 text-[var(--sg-warn)]">[de completat: {what}]</span>
}

function Section({ index, children }: { index: number; children: React.ReactNode }) {
  const { id, numeral, title } = SECTIONS[index]
  return (
    <section id={id} aria-labelledby={`${id}-titlu`} className="scroll-mt-24 space-y-4">
      <h2 id={`${id}-titlu`} className="text-xl font-bold text-ink">{numeral}. {title}</h2>
      <div className="space-y-4 text-[15px] leading-7 text-ink-soft">{children}</div>
    </section>
  )
}

function Sub({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="font-semibold text-ink">{label}</h3>
      {children}
    </div>
  )
}

/** Un scop de prelucrare, cu temeiul și consecința refuzului, ca în modelul clasic. */
function Purpose({ title, basis, consequence }: { title: React.ReactNode; basis: React.ReactNode; consequence: React.ReactNode }) {
  return (
    <div className="space-y-2 border-l-2 border-rule pl-4">
      <p className="text-ink">{title}</p>
      <p><strong className="font-semibold text-ink">Temei:</strong> {basis}</p>
      <p>{consequence}</p>
    </div>
  )
}

const linkClass = 'font-semibold text-[var(--sg-accent-ink)] underline underline-offset-4'
const strong = 'font-semibold text-ink'

/**
 * Politica de confidențialitate (art. 13–14 GDPR), publică, în forma clasică
 * a documentelor din România. Descrie exact ce face aplicația: câmpurile din
 * `profiles` și `projects`, emailurile trimise (bun venit, resetare parolă,
 * atribuiri, actualizări, remindere), jurnalul de audit, furnizorii și
 * stocarea din browser. Dacă se schimbă una dintre ele, se schimbă și textul.
 * Datele firmei vin din `lib/privacy-operator.ts`.
 */
export default function PrivacyPage() {
  const operator = privacyOperator()
  const operatorName = operator.name ?? <Missing what="denumirea firmei" />
  const email = operator.email
    ? <a className={linkClass} href={`mailto:${operator.email}`}>{operator.email}</a>
    : <Missing what="adresa de email" />

  return (
    <div className="mx-auto max-w-6xl pt-8">
      <nav aria-label="Înapoi" className="mb-8 text-sm">
        <Link href="/" className="text-ink-soft underline-offset-4 hover:text-ink hover:underline">← Înapoi la platformă</Link>
      </nav>

      <header className="mb-10 max-w-3xl space-y-3 border-b border-rule pb-8">
        <h1 className="text-3xl font-bold leading-tight tracking-tight text-ink sm:text-4xl">Politică de confidențialitate</h1>
        <p className="text-sm text-ink-faint">Ultima actualizare: {LAST_UPDATED}</p>
      </header>

      <div className="grid gap-10 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside>
          <nav aria-label="Cuprins" className="lg:sticky lg:top-24">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-faint">Cuprins</p>
            <ol className="space-y-1.5 text-sm">
              {SECTIONS.map(section => (
                <li key={section.id}>
                  <a href={`#${section.id}`} className="flex gap-2 text-ink-soft hover:text-ink">
                    <span className="w-9 shrink-0 text-ink-faint">{section.numeral}.</span>
                    <span>{section.title}</span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </aside>

        <article className="max-w-3xl space-y-12 pb-8">
          <Section index={0}>
            <p>
              Confidențialitatea datelor dumneavoastră cu caracter personal reprezintă una dintre preocupările principale ale {operatorName}, cu sediul în {operator.address ?? <Missing what="adresa sediului" />}, înregistrată sub codul unic de înregistrare {operator.cui ?? <Missing what="CUI" />} (denumită în continuare „Operatorul” sau „noi”).
            </p>
            <p>
              Acest document are rolul de a vă informa, în conformitate cu Regulamentul (UE) 2016/679 („GDPR”) și cu Legea nr. 190/2018, cu privire la prelucrarea datelor dumneavoastră cu caracter personal în contextul utilizării platformei Bonie, disponibilă la adresa www.kabinet.ro (denumită în continuare „Platforma”).
            </p>
            <p>
              Platforma este folosită de Operator pentru gestionarea proiectelor de finanțare pe care le pregătește și le implementează pentru clienții săi: fazele și activitățile proiectului, documentele cerute clientului și versiunile lor, termenele, discuțiile și istoricul acțiunilor.
            </p>
            <p>
              Platforma are trei tipuri de utilizatori: <strong className={strong}>administratorii</strong> și <strong className={strong}>consultanții</strong> Operatorului, respectiv <strong className={strong}>clienții</strong>, adică reprezentanții beneficiarilor finanțării. Conturile se creează numai de către un administrator; Platforma nu permite înregistrarea publică.
            </p>
          </Section>

          <Section index={1}>
            <Sub label="II.1. Operatorul are calitatea de operator de date">
              <p>
                Pentru datele contului dumneavoastră de utilizator, pentru datele necesare derulării relației contractuale, pentru mesajele transmise prin Platformă și pentru datele înregistrate în jurnalul de activitate, {operatorName} are calitatea de operator de date, în sensul art. 4 pct. 7 GDPR.
              </p>
            </Sub>
            <Sub label="II.2. Operatorul are calitatea de persoană împuternicită">
              <p>
                Pentru documentele încărcate în dosarul unui proiect care privesc alte persoane decât utilizatorul (de exemplu asociații, reprezentanții legali, angajații sau experții beneficiarului), Operatorul prelucrează datele în numele beneficiarului finanțării, în calitate de persoană împuternicită de operator, în sensul art. 28 GDPR, exclusiv pentru pregătirea, depunerea și implementarea proiectului și numai potrivit contractului de consultanță încheiat cu beneficiarul.
              </p>
              <p>
                În această situație, beneficiarul are calitatea de operator de date și răspunde de informarea persoanelor ale căror date le transmite prin Platformă.
              </p>
            </Sub>
          </Section>

          <Section index={2}>
            <Sub label="III.1. Dacă sunteți client al Operatorului">
              <p>
                Prelucrăm datele contului dumneavoastră: numele și prenumele, adresa de e-mail și numărul de telefon, precum și datele societății pe care o reprezentați: denumirea, codul de identificare fiscală, adresa sediului și persoana de contact. Pentru fiecare proiect pot fi înregistrate, în plus, numele, adresa de e-mail și telefonul persoanei de contact a proiectului.
              </p>
              <p>
                Prelucrăm de asemenea documentele pe care le încărcați ca răspuns la cererile consultantului, versiunile succesive ale acestora și eventualele motive de respingere, precum și mesajele și imaginile pe care le transmiteți în discuția proiectului.
              </p>
            </Sub>
            <Sub label="III.2. Dacă datele dumneavoastră se regăsesc în documentele dosarului unui proiect">
              <p>
                Prelucrăm datele cuprinse în documentele încărcate în Platformă la cererea consultantului, potrivit ghidului de finanțare aplicabil, de exemplu datele din actele de identitate ale asociaților (inclusiv codul numeric personal), din certificatele de cazier judiciar și fiscal, din situațiile financiare sau din declarații.
              </p>
            </Sub>
            <Sub label="III.3. Dacă sunteți administrator sau consultant al Operatorului">
              <p>
                Prelucrăm datele contului dumneavoastră (numele, adresa de e-mail, telefonul, departamentul, specializarea, rolul și nivelul de consultant), proiectele, activitățile și cererile care vă sunt atribuite, precum și mesajele transmise în discuțiile de proiect și în conversațiile private dintre membrii echipei.
              </p>
            </Sub>
            <Sub label="III.4. Pentru toți utilizatorii">
              <p>
                Platforma înregistrează automat, într-un jurnal de activitate, autentificările și deconectările, precum și acțiunile relevante asupra proiectelor și documentelor (de exemplu crearea, modificarea, publicarea, încărcarea, descărcarea, aprobarea sau respingerea unui document), împreună cu data și ora, adresa IP și tipul de browser folosit. Parola contului nu este cunoscută de Operator: este păstrată de furnizorul de autentificare numai sub formă criptată ireversibil.
              </p>
              <p>
                La solicitarea resetării parolei, Platforma păstrează temporar adresa de e-mail, adresa IP și tipul de browser, pentru a limita încercările abuzive; aceste date se șterg automat la expirarea cererii.
              </p>
            </Sub>
          </Section>

          <Section index={3}>
            <p>Operatorul prelucrează datele dumneavoastră cu caracter personal astfel:</p>
            <Purpose
              title="pentru crearea și administrarea contului de utilizator, inclusiv transmiterea, la crearea contului, a unui e-mail de bun venit cu o parolă temporară, care trebuie schimbată la prima autentificare, precum și pentru resetarea parolei la cererea dumneavoastră."
              basis="Prelucrarea are la bază contractul încheiat între dumneavoastră (sau societatea pe care o reprezentați) și Operator, potrivit art. 6 alin. (1) lit. b) GDPR."
              consequence="Furnizarea adresei de e-mail este necesară pentru crearea contului. Refuzul furnizării ei face imposibilă folosirea Platformei."
            />
            <Purpose
              title="pentru desfășurarea proiectului de finanțare: transmiterea cererilor de documente, primirea și verificarea documentelor încărcate, comunicarea motivelor de respingere, atribuirea activităților și a cererilor către consultanți și discuțiile din cadrul proiectului."
              basis="Prelucrarea are la bază contractul de consultanță încheiat cu Operatorul, potrivit art. 6 alin. (1) lit. b) GDPR."
              consequence="Furnizarea datelor și a documentelor solicitate este necesară pentru executarea contractului. Refuzul poate face imposibilă pregătirea sau depunerea proiectului."
            />
            <Purpose
              title={<>pentru informarea dumneavoastră prin e-mail și prin notificări în Platformă: clienții primesc un e-mail atunci când consultantul publică cereri noi sau verifică documentele trimise, iar consultanții atunci când le este atribuită o cerere sau o activitate. Pentru termenele apropiate, Platforma trimite zilnic remindere automate, cu 7, 3 și 1 zi înainte de termen, în ziua termenului și după depășirea lui; reminderele automate pot fi oprite pentru fiecare proiect.</>}
              basis="Prelucrarea are la bază contractul încheiat cu Operatorul, potrivit art. 6 alin. (1) lit. b) GDPR."
              consequence="Fără o adresă de e-mail validă nu vă putem anunța cererile și termenele, ceea ce poate duce la depășirea lor."
            />
            <Purpose
              title="pentru prelucrarea documentelor din dosarul proiectului care privesc alte persoane, în numele beneficiarului finanțării."
              basis="Prelucrarea are loc pe baza instrucțiunilor beneficiarului, potrivit art. 28 GDPR. Beneficiarul prelucrează aceste date în temeiul obligațiilor care îi revin potrivit legislației privind finanțările nerambursabile și ghidului de finanțare aplicabil."
              consequence="Lipsa documentelor cerute de ghidul de finanțare poate duce la respingerea cererii de finanțare de către autoritatea competentă."
            />
            <Purpose
              title="pentru asigurarea securității Platformei și pentru a putea dovedi cine, când și ce operațiune a efectuat asupra proiectelor și documentelor (jurnalul de activitate)."
              basis="Prelucrarea are la bază interesul legitim al Operatorului de a proteja datele încredințate și de a putea reconstitui istoricul fiecărui proiect, potrivit art. 6 alin. (1) lit. f) GDPR."
              consequence="Aceste date se înregistrează automat la folosirea Platformei. Vă puteți opune prelucrării în condițiile descrise în secțiunea X."
            />
            <Purpose
              title="pentru păstrarea dosarului proiectului după încheierea acestuia, în vederea controalelor efectuate de autoritățile de management și de audit."
              basis="Prelucrarea are la bază obligațiile legale ale beneficiarului privind păstrarea documentelor proiectului, potrivit art. 6 alin. (1) lit. c) GDPR, precum și interesul legitim al Operatorului de a constata, exercita sau apăra un drept în instanță."
              consequence="Această prelucrare nu presupune nicio acțiune din partea dumneavoastră."
            />
            <p>
              Operatorul nu prelucrează datele dumneavoastră în scop de marketing, nu le vinde, nu folosește instrumente de analiză a comportamentului utilizatorilor și nu ia decizii individuale automatizate.
            </p>
          </Section>

          <Section index={4}>
            <p>
              În măsura în care ghidul de finanțare o cere, dosarul proiectului poate conține copii ale actelor de identitate, care cuprind codul numeric personal, precum și certificate de cazier judiciar, care conțin date privind condamnări penale, în sensul art. 10 GDPR. Prelucrarea acestor date se face cu respectarea garanțiilor prevăzute de art. 4 din Legea nr. 190/2018:
            </p>
            <ul className="list-disc space-y-2 pl-6">
              <li>cererile de documente care primesc astfel de date sunt marcate distinct în Platformă, iar la încărcare clientul este informat despre scopul și termenul de ștergere;</li>
              <li>fiecare descărcare a documentelor este înregistrată în jurnalul de activitate;</li>
              <li>certificatul de cazier judiciar se șterge automat la împlinirea a {CAZIER_DAYS_AFTER_APPROVAL} de zile de la aprobarea lui sau a {DAYS_AFTER_PROJECT_CLOSURE} de zile de la încheierea proiectului, oricare dintre aceste termene se împlinește primul;</li>
              <li>copiile actelor de identitate se șterg automat la împlinirea a {DAYS_AFTER_PROJECT_CLOSURE} de zile de la încheierea proiectului;</li>
              <li>odată cu fișierele se șterg și denumirile lor, care conțin de regulă numele persoanei.</li>
            </ul>
            <p>
              Ștergerea poate fi amânată numai de un administrator, printr-o decizie motivată înregistrată în jurnalul de activitate, de exemplu pe durata unui control al autorității de management.
            </p>
          </Section>

          <Section index={5}>
            <p>
              Ca principiu, Operatorul prelucrează datele dumneavoastră cu caracter personal atât cât este necesar pentru realizarea scopurilor de prelucrare menționate mai sus, după cum urmează:
            </p>
            <ul className="list-disc space-y-2 pl-6">
              <li>documentele, discuțiile și istoricul unui proiect se păstrează pe durata derulării proiectului și ulterior timp de 10 ani de la încheierea lui, având în vedere termenele în care autoritățile pot controla proiectele finanțate și regulile aplicabile ajutorului de stat; excepție fac datele cu caracter special, care se șterg la termenele din secțiunea V;</li>
              <li>datele contului de utilizator se păstrează pe durata colaborării; la încheierea ei, contul se dezactivează, iar datele rămân asociate documentelor și istoricului proiectelor pe durata păstrării acestora;</li>
              <li>înregistrările din jurnalul de activitate se păstrează pe aceeași durată ca proiectul la care se referă;</li>
              <li>datele aferente cererilor de resetare a parolei se șterg automat la expirarea cererii;</li>
              <li>copiile de siguranță ale bazei de date se păstrează {BACKUP_RETENTION_DAYS} zile, după care se șterg automat.</li>
            </ul>
          </Section>

          <Section index={6}>
            <p>Accesul la date este stabilit prin rolul fiecărui utilizator și este verificat de Platformă la fiecare operațiune:</p>
            <ul className="list-disc space-y-2 pl-6">
              <li>clientul vede numai proiectele proprii și, în cadrul lor, numai fazele, activitățile și cererile publicate de consultant, precum și ultima versiune a fiecărui document; el vede numele și adresa de e-mail ale consultanților din echipa proiectului;</li>
              <li>consultantul vede numai proiectele în care este membru al echipei, împreună cu datele clientului acestora;</li>
              <li>administratorii Operatorului au acces la toate proiectele, conturile și jurnalul de activitate.</li>
            </ul>
            <p>
              Pentru funcționarea Platformei, Operatorul folosește următorii furnizori de servicii, care acționează ca persoane împuternicite, pe bază de contract: <strong className={strong}>Supabase Inc.</strong> (baza de date, autentificarea și stocarea fișierelor, cu servere în Irlanda), <strong className={strong}>Vercel Inc.</strong> (găzduirea aplicației, cu servere în Irlanda) și <strong className={strong}>Resend Inc.</strong> (transmiterea mesajelor de e-mail, cu servere în Statele Unite ale Americii).
            </p>
            <p>Datele pot fi comunicate autorităților publice numai atunci când legea o impune.</p>
          </Section>

          <Section index={7}>
            <p>
              Datele și fișierele sunt stocate pe servere situate în Uniunea Europeană (Irlanda). Mesajele de e-mail sunt transmise prin servere din Statele Unite ale Americii, iar furnizorii menționați în secțiunea VII sunt societăți cu sediul în această țară. Orice transfer sau acces din afara Spațiului Economic European are loc în baza deciziei de adecvare a Comisiei Europene privind Cadrul UE–SUA pentru protecția datelor (EU-U.S. Data Privacy Framework), în cazul furnizorilor certificați, și a clauzelor contractuale standard aprobate prin Decizia de punere în aplicare (UE) 2021/914 a Comisiei.
            </p>
          </Section>

          <Section index={8}>
            <p>Operatorul aplică măsuri tehnice și organizatorice adecvate pentru protejarea datelor cu caracter personal, potrivit art. 32 GDPR, printre care:</p>
            <ul className="list-disc space-y-2 pl-6">
              <li>toate comunicațiile cu Platforma sunt criptate (HTTPS), iar datele sunt stocate criptat de furnizor;</li>
              <li>fișierele sunt păstrate într-un spațiu de stocare privat și pot fi deschise numai prin legături temporare, generate după verificarea dreptului de acces;</li>
              <li>dreptul de acces se verifică în funcție de rol la fiecare operațiune;</li>
              <li>conturile se creează numai de administratori, iar parola temporară trebuie schimbată la prima autentificare;</li>
              <li>cererile de resetare a parolei sunt limitate, pentru a preveni încercările abuzive;</li>
              <li>jurnalul de activitate nu poate fi modificat ulterior, iar datele de autentificare (parole, chei de acces) nu sunt înregistrate în el;</li>
              <li>baza de date este copiată automat în fiecare zi.</li>
            </ul>
            <p>
              În cazul unei încălcări a securității datelor cu caracter personal, Operatorul va notifica Autoritatea Națională de Supraveghere a Prelucrării Datelor cu Caracter Personal în termen de cel mult 72 de ore de la constatare, precum și persoanele vizate, atunci când încălcarea este susceptibilă să genereze un risc ridicat pentru drepturile și libertățile acestora.
            </p>
          </Section>

          <Section index={9}>
            <p>
              În condițiile prevăzute de legislația în materia prelucrării datelor cu caracter personal, în calitate de persoane vizate, beneficiați de următoarele drepturi:
            </p>
            <ul className="list-disc space-y-3 pl-6">
              <li><strong className={strong}>dreptul la informare</strong>, respectiv dreptul de a primi detalii privind activitățile de prelucrare efectuate de Operator, conform celor descrise în prezentul document;</li>
              <li><strong className={strong}>dreptul de acces la date</strong>, respectiv dreptul de a obține confirmarea din partea Operatorului cu privire la prelucrarea datelor cu caracter personal, precum și detalii privind modalitatea în care sunt prelucrate, scopul prelucrării și destinatarii datelor;</li>
              <li><strong className={strong}>dreptul la rectificare</strong>, respectiv dreptul de a obține corectarea, fără întârzieri nejustificate, a datelor cu caracter personal inexacte, precum și completarea datelor incomplete;</li>
              <li>
                <strong className={strong}>dreptul la ștergerea datelor</strong> („dreptul de a fi uitat”), fără întârzieri nejustificate, în cazul în care se aplică unul dintre următoarele motive:
                <ul className="mt-2 list-[circle] space-y-1 pl-6">
                  <li>datele nu mai sunt necesare pentru îndeplinirea scopurilor pentru care au fost colectate sau prelucrate;</li>
                  <li>persoana vizată se opune prelucrării și nu există motive legitime care să prevaleze;</li>
                  <li>datele au fost prelucrate ilegal;</li>
                  <li>datele trebuie șterse pentru respectarea unei obligații legale.</li>
                </ul>
                <span className="mt-2 block">Dreptul la ștergere nu se aplică în măsura în care prelucrarea este necesară pentru respectarea unei obligații legale sau pentru constatarea, exercitarea ori apărarea unui drept în instanță, potrivit art. 17 alin. (3) GDPR.</span>
              </li>
              <li>
                <strong className={strong}>dreptul la restricționarea prelucrării</strong>, în măsura în care:
                <ul className="mt-2 list-[circle] space-y-1 pl-6">
                  <li>persoana contestă exactitatea datelor, pe o perioadă care ne permite verificarea corectitudinii lor;</li>
                  <li>prelucrarea este ilegală, iar persoana vizată se opune ștergerii datelor, solicitând în schimb restricționarea utilizării lor;</li>
                  <li>Operatorul nu mai are nevoie de date, dar persoana vizată i le solicită pentru constatarea, exercitarea sau apărarea unui drept în instanță;</li>
                  <li>persoana vizată s-a opus prelucrării, pentru intervalul în care se verifică dacă interesele legitime ale Operatorului prevalează.</li>
                </ul>
              </li>
              <li><strong className={strong}>dreptul la portabilitatea datelor</strong>, respectiv dreptul de a primi datele cu caracter personal într-un format structurat, utilizat în mod curent și care poate fi citit automat, precum și dreptul ca aceste date să fie transmise de Operator către alt operator, în măsura în care sunt îndeplinite condițiile prevăzute de lege; documentele pe care le-ați încărcat pot fi descărcate oricând din Platformă;</li>
              <li><strong className={strong}>dreptul la opoziție</strong>, respectiv dreptul de a vă opune în orice moment, din motive legate de situația particulară în care vă aflați, prelucrării datelor în temeiul interesului legitim al Operatorului, cu excepția cazurilor în care Operatorul demonstrează motive legitime și imperioase care prevalează sau prelucrarea are ca scop constatarea, exercitarea sau apărarea unui drept în instanță;</li>
              <li><strong className={strong}>dreptul de a nu fi supus unei decizii individuale automate</strong>, inclusiv crearea de profiluri, care produce efecte juridice sau vă afectează în mod similar într-o măsură semnificativă;</li>
              <li><strong className={strong}>dreptul de a vă adresa</strong> Autorității Naționale de Supraveghere a Prelucrării Datelor cu Caracter Personal (B-dul G-ral. Gheorghe Magheru nr. 28-30, sector 1, București,{' '}<a className={linkClass} href="https://www.dataprotection.ro" target="_blank" rel="noopener noreferrer">www.dataprotection.ro</a>) sau instanțelor competente, în măsura în care considerați necesar.</li>
            </ul>
            <p>
              Pentru documentele din dosarul unui proiect, în privința cărora Operatorul acționează ca persoană împuternicită, cererea dumneavoastră va fi transmisă și beneficiarului finanțării, în calitate de operator, iar Operatorul îl va sprijini în soluționarea ei.
            </p>
            <p>
              Pentru orice întrebări suplimentare cu privire la modul în care datele cu caracter personal sunt prelucrate și pentru a vă exercita drepturile menționate mai sus, vă rugăm să vă adresați la adresa de e-mail: {email}
              {operator.dpo && <>, sau responsabilului cu protecția datelor: {operator.dpo}</>}. Vom răspunde fără întârzieri nejustificate și în cel mult o lună de la primirea cererii, termen care poate fi prelungit cu încă două luni pentru cereri complexe, cu informarea dumneavoastră. Exercitarea drepturilor este gratuită.
            </p>
          </Section>

          <Section index={10}>
            <p>
              Platforma folosește exclusiv cookie-uri și elemente de stocare în browser strict necesare pentru furnizarea serviciului solicitat de dumneavoastră:
            </p>
            <ul className="list-disc space-y-2 pl-6">
              <li>sesiunea de autentificare, păstrată în browser până la deconectare;</li>
              <li>un cookie care confirmă resetarea parolei, valabil 24 de ore;</li>
              <li>preferințele de afișare alese de dumneavoastră (de exemplu modul de afișare și ordinea proiectelor, starea panoului de faze sau a vederii fișierelor).</li>
            </ul>
            <p>
              Platforma nu folosește cookie-uri de analiză, de publicitate sau ale unor terți și nu încarcă resurse de la terți, inclusiv fonturi. Potrivit art. 4 alin. (6) din Legea nr. 506/2004, pentru aceste elemente nu este necesar consimțământul dumneavoastră. Le puteți șterge oricând din setările browserului, cu consecința deconectării din Platformă.
            </p>
          </Section>

          <Section index={11}>
            <p>
              Operatorul poate actualiza prezenta politică ori de câte ori se modifică funcționalitățile Platformei sau legislația aplicabilă. Data ultimei actualizări este indicată la începutul documentului. Modificările importante vor fi aduse la cunoștința clienților prin e-mail, înainte de intrarea lor în vigoare.
            </p>
          </Section>
        </article>
      </div>
    </div>
  )
}
