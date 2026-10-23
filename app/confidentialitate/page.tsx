import type { Metadata } from 'next'
import Link from 'next/link'
import { privacyOperator } from '@/lib/privacy-operator'
import { CAZIER_DAYS_AFTER_APPROVAL, DAYS_AFTER_PROJECT_CLOSURE } from '@/lib/sensitive-documents'
import { BACKUP_RETENTION_DAYS } from '@/lib/db-backup'

export const metadata: Metadata = {
  title: 'Politică de confidențialitate',
  description: 'Informații privind prelucrarea datelor cu caracter personal în platforma de management al proiectelor de finanțare.',
}

const LAST_UPDATED = 'octombrie 2026'

const SECTIONS = [
  { id: 'informatii-generale', numeral: 'I', title: 'Informații generale' },
  { id: 'calitatea', numeral: 'II', title: 'Calitatea în care prelucrăm datele' },
  { id: 'categorii', numeral: 'III', title: 'Categoriile de date cu caracter personal prelucrate' },
  { id: 'scopuri', numeral: 'IV', title: 'Scopurile și temeiurile prelucrării' },
  { id: 'sensibile', numeral: 'V', title: 'Date cu caracter special' },
  { id: 'durata', numeral: 'VI', title: 'Durata pentru care vă prelucrăm datele' },
  { id: 'dezvaluire', numeral: 'VII', title: 'Dezvăluirea datelor cu caracter personal' },
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

/**
 * Politica de confidențialitate (art. 13–14 GDPR), publică, în forma
 * obișnuită a documentelor de acest tip din România. Datele firmei vin din
 * `lib/privacy-operator.ts`. Se validează de un avocat pe protecția datelor.
 *
 * Textul promite doar ce face aplicația: termenele cu cifre sunt cele
 * implementate (documentele sensibile, copiile bazei).
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
              Acest document are rolul de a vă informa, în conformitate cu Regulamentul (UE) 2016/679 („GDPR”) și cu Legea nr. 190/2018, cu privire la prelucrarea datelor dumneavoastră cu caracter personal în contextul utilizării platformei de management al proiectelor de finanțare (denumită în continuare „Platforma”).
            </p>
            <p>
              Platforma este destinată exclusiv clienților noștri, beneficiari sau potențiali beneficiari ai unor finanțări nerambursabile, precum și personalului nostru. Conturile se creează numai de către administratorul Platformei; nu există înregistrare publică.
            </p>
          </Section>

          <Section index={1}>
            <Sub label="II.1. Operatorul este operator de date">
              <p>
                Pentru datele contului dumneavoastră de utilizator, pentru datele necesare derulării relației contractuale și pentru datele tehnice înregistrate în jurnalul de securitate al Platformei, {operatorName} are calitatea de operator de date, în sensul art. 4 pct. 7 GDPR.
              </p>
            </Sub>
            <Sub label="II.2. Operatorul este persoană împuternicită">
              <p>
                Pentru documentele încărcate în dosarul unui proiect de finanțare care privesc alte persoane decât utilizatorul (de exemplu asociații, reprezentanții legali, angajații sau experții beneficiarului), prelucrăm datele în numele beneficiarului finanțării, în calitate de persoană împuternicită de operator, în sensul art. 28 GDPR, exclusiv pentru pregătirea, depunerea și implementarea proiectului și numai potrivit contractului de consultanță încheiat cu beneficiarul.
              </p>
              <p>
                În această situație, beneficiarul are calitatea de operator de date și răspunde de informarea persoanelor ale căror date ni le transmite.
              </p>
            </Sub>
          </Section>

          <Section index={2}>
            <Sub label="III.1. Dacă sunteți client al Platformei">
              <p>
                Vom prelucra datele dumneavoastră cu caracter personal, cum ar fi numele și prenumele, adresa de e-mail, numărul de telefon, funcția, denumirea și datele de identificare ale societății pe care o reprezentați (denumire, cod de identificare fiscală, adresa sediului), precum și orice alte date pe care ni le furnizați în mod direct prin intermediul Platformei, inclusiv mesajele transmise în discuțiile de proiect.
              </p>
            </Sub>
            <Sub label="III.2. Dacă datele dumneavoastră se regăsesc în documentele unui dosar de finanțare">
              <p>
                Vom prelucra datele care se regăsesc în documentele încărcate în Platformă de beneficiarul finanțării, precum datele de identificare din actele de identitate (inclusiv codul numeric personal), datele din certificatele de cazier judiciar și fiscal, datele din situațiile financiare, din declarații sau din curriculum vitae, în măsura în care aceste documente sunt cerute de ghidul de finanțare aplicabil.
              </p>
            </Sub>
            <Sub label="III.3. Dacă sunteți membru al personalului nostru">
              <p>
                Vom prelucra datele contului dumneavoastră (nume, adresă de e-mail, telefon, departament, specializare, rol) și activitatea desfășurată în Platformă în legătură cu proiectele la care lucrați.
              </p>
            </Sub>
            <Sub label="III.4. Pentru toți utilizatorii">
              <p>
                Platforma înregistrează automat acțiunile relevante efectuate de utilizatori (de exemplu încărcarea, descărcarea, aprobarea sau respingerea unui document), împreună cu data și ora, adresa IP și tipul de browser folosit.
              </p>
            </Sub>
          </Section>

          <Section index={3}>
            <p>Operatorul prelucrează datele dumneavoastră cu caracter personal astfel:</p>
            <Purpose
              title="pentru crearea și administrarea contului de utilizator, pentru accesul la proiectele care vă privesc și pentru desfășurarea relației contractuale dintre dumneavoastră (sau societatea pe care o reprezentați) și Operator, respectiv pregătirea, depunerea și implementarea proiectului de finanțare, transmiterea cererilor de documente și verificarea acestora."
              basis="Prelucrarea datelor dumneavoastră în acest scop are la bază contractul de consultanță încheiat cu Operatorul, potrivit art. 6 alin. (1) lit. b) GDPR."
              consequence="Furnizarea datelor dumneavoastră cu caracter personal este necesară pentru executarea acestui contract. Refuzul furnizării datelor poate avea drept consecință imposibilitatea derulării raporturilor contractuale dintre dumneavoastră și Operator."
            />
            <Purpose
              title="pentru informarea dumneavoastră, prin e-mail și prin notificări în Platformă, cu privire la documentele solicitate, la termenele proiectului și la stadiul verificării documentelor."
              basis="Prelucrarea datelor dumneavoastră în acest scop are la bază contractul încheiat cu Operatorul, potrivit art. 6 alin. (1) lit. b) GDPR."
              consequence="Furnizarea adresei de e-mail este necesară; în lipsa ei nu vă putem anunța termenele, ceea ce poate duce la depășirea lor."
            />
            <Purpose
              title="pentru prelucrarea documentelor din dosarul de finanțare care privesc alte persoane, în numele beneficiarului finanțării."
              basis="Prelucrarea are loc pe baza instrucțiunilor documentate ale beneficiarului, potrivit art. 28 GDPR. Beneficiarul prelucrează aceste date în temeiul obligațiilor care îi revin potrivit legislației privind finanțările nerambursabile și ghidului de finanțare aplicabil."
              consequence="Lipsa documentelor cerute de ghidul de finanțare poate duce la respingerea cererii de finanțare de către autoritatea competentă."
            />
            <Purpose
              title="pentru asigurarea securității Platformei, prevenirea accesului neautorizat și dovedirea operațiunilor efectuate asupra documentelor."
              basis="Prelucrarea datelor dumneavoastră în acest scop are la bază interesul legitim al Operatorului de a proteja datele încredințate și de a putea demonstra cine, când și ce operațiune a efectuat, potrivit art. 6 alin. (1) lit. f) GDPR."
              consequence="Aceste date se înregistrează automat la utilizarea Platformei; puteți formula opoziție în condițiile prevăzute la secțiunea X."
            />
            <Purpose
              title="pentru păstrarea dosarului proiectului după încheierea acestuia, în vederea controalelor și verificărilor efectuate de autoritățile de management și de audit."
              basis="Prelucrarea are la bază obligațiile legale ale beneficiarului privind păstrarea documentelor proiectului, potrivit art. 6 alin. (1) lit. c) GDPR, precum și interesul legitim al Operatorului de a constata, exercita sau apăra un drept în instanță."
              consequence="Furnizarea datelor în acest scop nu presupune nicio acțiune din partea dumneavoastră."
            />
            <p>
              Operatorul nu prelucrează datele dumneavoastră în scop de marketing direct, nu le vinde și nu le folosește pentru crearea de profiluri sau pentru decizii individuale automatizate.
            </p>
          </Section>

          <Section index={4}>
            <p>
              În măsura în care ghidul de finanțare o cere, dosarul proiectului poate conține copii ale actelor de identitate, care cuprind codul numeric personal, precum și certificate de cazier judiciar, care conțin date privind condamnări penale, în sensul art. 10 GDPR. Prelucrarea acestor date se face cu respectarea garanțiilor prevăzute de art. 4 din Legea nr. 190/2018, după cum urmează:
            </p>
            <ul className="list-disc space-y-2 pl-6">
              <li>cererile de documente care conțin astfel de date sunt marcate distinct în Platformă, iar accesul la ele este limitat la persoanele implicate în proiect;</li>
              <li>fiecare descărcare a acestor documente este înregistrată în jurnalul de securitate;</li>
              <li>certificatul de cazier judiciar se șterge automat la împlinirea a {CAZIER_DAYS_AFTER_APPROVAL} de zile de la aprobarea lui sau a {DAYS_AFTER_PROJECT_CLOSURE} de zile de la încheierea proiectului, oricare dintre aceste termene se împlinește primul;</li>
              <li>copiile actelor de identitate se șterg automat la împlinirea a {DAYS_AFTER_PROJECT_CLOSURE} de zile de la încheierea proiectului.</li>
            </ul>
            <p>
              Ștergerea poate fi amânată numai printr-o decizie motivată a Operatorului, înregistrată în jurnalul de securitate, de exemplu pe durata unui control al autorității de management.
            </p>
          </Section>

          <Section index={5}>
            <p>
              Ca principiu, Operatorul va prelucra datele dumneavoastră cu caracter personal atât cât este necesar pentru realizarea scopurilor de prelucrare menționate mai sus.
            </p>
            <p>
              Documentele și istoricul unui proiect de finanțare se păstrează pe durata derulării proiectului și ulterior pe o perioadă de 10 ani de la încheierea acestuia, având în vedere termenele în care autoritățile pot efectua controale asupra proiectelor finanțate și regulile aplicabile ajutorului de stat. Excepție fac datele cu caracter special, care se șterg la termenele menționate în secțiunea V.
            </p>
            <p>
              Datele contului de utilizator se prelucrează pe întreaga durată a raporturilor contractuale și ulterior pe durata termenului general de prescripție de 3 ani, prevăzut de art. 2517 din Codul civil.
            </p>
            <p>
              Copiile de siguranță ale bazei de date se păstrează {BACKUP_RETENTION_DAYS} zile, după care se șterg automat.
            </p>
          </Section>

          <Section index={6}>
            <p>
              Pentru îndeplinirea scopurilor de prelucrare, Operatorul poate dezvălui datele dumneavoastră cu caracter personal către:
            </p>
            <ul className="list-disc space-y-2 pl-6">
              <li>membrii personalului Operatorului implicați în proiect și clientul proiectului, fiecare în limita rolului său în Platformă;</li>
              <li>furnizorii de servicii IT care sprijină Operatorul în funcționarea Platformei și care acționează ca persoane împuternicite, pe bază de contract: Supabase Inc. (baza de date, autentificarea și stocarea fișierelor, cu servere în Irlanda), Vercel Inc. (găzduirea aplicației, cu servere în Irlanda) și Resend Inc. (transmiterea mesajelor de e-mail, cu servere în Statele Unite ale Americii);</li>
              <li>autoritățile publice centrale sau locale, atunci când dezvăluirea datelor este prevăzută de lege.</li>
            </ul>
          </Section>

          <Section index={7}>
            <p>
              Datele cu caracter personal sunt stocate pe servere situate în Uniunea Europeană. Întrucât furnizorii menționați în secțiunea VII sunt societăți cu sediul în Statele Unite ale Americii, datele pot fi transferate sau accesate din afara Spațiului Economic European. Orice astfel de transfer are loc în baza deciziei de adecvare a Comisiei Europene privind Cadrul UE–SUA pentru protecția datelor (EU-U.S. Data Privacy Framework), în cazul furnizorilor certificați, și a clauzelor contractuale standard aprobate prin Decizia de punere în aplicare (UE) 2021/914 a Comisiei.
            </p>
          </Section>

          <Section index={8}>
            <p>
              Operatorul aplică măsuri tehnice și organizatorice adecvate pentru protejarea datelor cu caracter personal, potrivit art. 32 GDPR, printre care: criptarea comunicațiilor, stocarea fișierelor într-un spațiu privat accesibil numai prin legături temporare, controlul accesului în funcție de rol, jurnalul de securitate care nu poate fi modificat, copiile de siguranță ale bazei de date și obligațiile de confidențialitate asumate de personal.
            </p>
            <p>
              În cazul unei încălcări a securității datelor cu caracter personal, Operatorul va notifica Autoritatea Națională de Supraveghere a Prelucrării Datelor cu Caracter Personal în termen de cel mult 72 de ore de la constatare, precum și persoanele vizate, atunci când încălcarea este susceptibilă să genereze un risc ridicat pentru drepturile și libertățile acestora.
            </p>
          </Section>

          <Section index={9}>
            <p>
              În condițiile prevăzute de legislația în materia prelucrării datelor cu caracter personal, în calitate de persoane vizate, beneficiați de următoarele drepturi:
            </p>
            <ul className="list-disc space-y-3 pl-6">
              <li><strong className="font-semibold text-ink">dreptul la informare</strong>, respectiv dreptul de a primi detalii privind activitățile de prelucrare efectuate de Operator, conform celor descrise în prezentul document;</li>
              <li><strong className="font-semibold text-ink">dreptul de acces la date</strong>, respectiv dreptul de a obține confirmarea din partea Operatorului cu privire la prelucrarea datelor cu caracter personal, precum și detalii privind activitățile de prelucrare, cum ar fi modalitatea în care sunt prelucrate datele, scopul prelucrării și destinatarii datelor;</li>
              <li><strong className="font-semibold text-ink">dreptul la rectificare</strong>, respectiv dreptul de a obține corectarea, fără întârzieri nejustificate, a datelor cu caracter personal inexacte, precum și completarea datelor incomplete;</li>
              <li>
                <strong className="font-semibold text-ink">dreptul la ștergerea datelor</strong> („dreptul de a fi uitat”), fără întârzieri nejustificate, în cazul în care se aplică unul dintre următoarele motive:
                <ul className="mt-2 list-[circle] space-y-1 pl-6">
                  <li>datele nu mai sunt necesare pentru îndeplinirea scopurilor pentru care au fost colectate sau prelucrate;</li>
                  <li>persoana vizată se opune prelucrării și nu există motive legitime care să prevaleze;</li>
                  <li>datele au fost prelucrate ilegal;</li>
                  <li>datele trebuie șterse pentru respectarea unei obligații legale.</li>
                </ul>
                <span className="mt-2 block">Dreptul la ștergere nu se aplică în măsura în care prelucrarea este necesară pentru respectarea unei obligații legale sau pentru constatarea, exercitarea ori apărarea unui drept în instanță, potrivit art. 17 alin. (3) GDPR.</span>
              </li>
              <li>
                <strong className="font-semibold text-ink">dreptul la restricționarea prelucrării</strong>, în măsura în care:
                <ul className="mt-2 list-[circle] space-y-1 pl-6">
                  <li>persoana contestă exactitatea datelor, pe o perioadă care ne permite verificarea corectitudinii lor;</li>
                  <li>prelucrarea este ilegală, iar persoana vizată se opune ștergerii datelor, solicitând în schimb restricționarea utilizării lor;</li>
                  <li>Operatorul nu mai are nevoie de date, dar persoana vizată i le solicită pentru constatarea, exercitarea sau apărarea unui drept în instanță;</li>
                  <li>persoana vizată s-a opus prelucrării, pentru intervalul în care se verifică dacă interesele legitime ale Operatorului prevalează.</li>
                </ul>
              </li>
              <li><strong className="font-semibold text-ink">dreptul la portabilitatea datelor</strong>, respectiv dreptul de a primi datele cu caracter personal într-un format structurat, utilizat în mod curent și care poate fi citit automat, precum și dreptul ca aceste date să fie transmise de Operator către alt operator, în măsura în care sunt îndeplinite condițiile prevăzute de lege;</li>
              <li><strong className="font-semibold text-ink">dreptul la opoziție</strong>, respectiv dreptul de a vă opune în orice moment, din motive legate de situația particulară în care vă aflați, prelucrării datelor în temeiul interesului legitim al Operatorului, cu excepția cazurilor în care Operatorul demonstrează motive legitime și imperioase care prevalează sau prelucrarea are ca scop constatarea, exercitarea sau apărarea unui drept în instanță;</li>
              <li><strong className="font-semibold text-ink">dreptul de a nu fi supus unei decizii individuale automate</strong>, inclusiv crearea de profiluri, care produce efecte juridice sau vă afectează în mod similar într-o măsură semnificativă;</li>
              <li><strong className="font-semibold text-ink">dreptul de a vă adresa</strong> Autorității Naționale de Supraveghere a Prelucrării Datelor cu Caracter Personal (B-dul G-ral. Gheorghe Magheru nr. 28-30, sector 1, București,{' '}<a className={linkClass} href="https://www.dataprotection.ro" target="_blank" rel="noopener noreferrer">www.dataprotection.ro</a>) sau instanțelor competente, în măsura în care considerați necesar.</li>
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
              Platforma folosește exclusiv cookie-uri și elemente de stocare locală strict necesare pentru furnizarea serviciului solicitat de dumneavoastră: menținerea sesiunii de autentificare, confirmarea resetării parolei (cookie valabil 24 de ore) și păstrarea preferințelor de afișare alese de dumneavoastră. Platforma nu folosește cookie-uri de analiză, de publicitate sau ale unor terți.
            </p>
            <p>
              Potrivit art. 4 alin. (6) din Legea nr. 506/2004, pentru aceste elemente nu este necesar consimțământul dumneavoastră. Le puteți șterge oricând din setările browserului, cu consecința deconectării din Platformă.
            </p>
          </Section>

          <Section index={11}>
            <p>
              Operatorul poate actualiza prezenta politică ori de câte ori se modifică serviciile oferite prin Platformă sau legislația aplicabilă. Data ultimei actualizări este indicată la începutul documentului. Modificările importante vor fi aduse la cunoștința clienților prin e-mail, înainte de intrarea lor în vigoare.
            </p>
          </Section>
        </article>
      </div>
    </div>
  )
}
