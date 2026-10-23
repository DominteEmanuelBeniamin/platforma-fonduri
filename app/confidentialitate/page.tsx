import type { Metadata } from 'next'
import Link from 'next/link'
import { privacyOperator } from '@/lib/privacy-operator'
import { CAZIER_DAYS_AFTER_APPROVAL, DAYS_AFTER_PROJECT_CLOSURE } from '@/lib/sensitive-documents'
import { BACKUP_RETENTION_DAYS } from '@/lib/db-backup'

export const metadata: Metadata = {
  title: 'Politica de confidențialitate',
  description: 'Cum prelucrăm datele cu caracter personal în platforma de management al proiectelor de finanțare.',
}

const LAST_UPDATED = '22 octombrie 2026'
const VERSION = '1.0'

const SECTIONS = [
  { id: 'operator', title: 'Cine este operatorul' },
  { id: 'roluri', title: 'Operator și persoană împuternicită' },
  { id: 'date', title: 'Ce date prelucrăm' },
  { id: 'scopuri', title: 'Scopuri și temeiuri legale' },
  { id: 'sensibile', title: 'Date din categorii speciale' },
  { id: 'destinatari', title: 'Destinatari' },
  { id: 'transferuri', title: 'Transferuri în afara UE' },
  { id: 'pastrare', title: 'Durata stocării' },
  { id: 'securitate', title: 'Securitatea datelor' },
  { id: 'drepturi', title: 'Drepturile dumneavoastră' },
  { id: 'cookie-uri', title: 'Cookie-uri și stocare locală' },
  { id: 'modificari', title: 'Modificări ale politicii' },
  { id: 'contact', title: 'Contact' },
] as const

function Missing({ what }: { what: string }) {
  return <span className="rounded-[var(--radius-plate)] bg-[var(--sg-warn-soft)] px-1 text-[var(--sg-warn)]">[de completat: {what}]</span>
}

function Section({ index, children }: { index: number; children: React.ReactNode }) {
  const { id, title } = SECTIONS[index]
  return (
    <section id={id} aria-labelledby={`${id}-titlu`} className="scroll-mt-24 space-y-3">
      <h2 id={`${id}-titlu`} className="text-lg font-bold text-ink">
        <span className="mr-2 font-semibold tabular-nums text-ink-faint">{index + 1}.</span>{title}
      </h2>
      <div className="space-y-3 text-[15px] leading-relaxed text-ink-soft">{children}</div>
    </section>
  )
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-[var(--radius-plate)] border border-rule bg-plate">
      <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
        <thead>
          <tr>
            {head.map(cell => (
              <th key={cell} scope="col" className="border-b border-rule bg-paper-sunk px-3 py-2 text-xs font-semibold text-ink-soft">{cell}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="align-top">
              {row.map((cell, index) => (
                <td key={index} className={`border-b border-rule px-3 py-2.5 ${rowIndex === rows.length - 1 ? 'border-b-0' : ''} ${index === 0 ? 'font-semibold text-ink' : 'text-ink-soft'}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const linkClass = 'font-semibold text-[var(--sg-accent-ink)] underline underline-offset-4'

/**
 * Politica de confidențialitate (art. 13–14 GDPR), publică. Datele firmei vin
 * din `lib/privacy-operator.ts`. Textul se validează de un avocat pe
 * protecția datelor înainte de folosirea cu clienți reali.
 */
export default function PrivacyPage() {
  const operator = privacyOperator()
  const email = operator.email
    ? <a className={linkClass} href={`mailto:${operator.email}`}>{operator.email}</a>
    : <Missing what="adresa de email" />
  const operatorName = operator.name ?? <Missing what="denumirea firmei" />

  return (
    <div className="mx-auto max-w-6xl pt-8">
      <nav aria-label="Înapoi" className="mb-8 text-sm">
        <Link href="/" className="text-ink-soft underline-offset-4 hover:text-ink hover:underline">← Înapoi la platformă</Link>
      </nav>

      <header className="mb-10 max-w-3xl space-y-4 border-b border-rule pb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Document juridic</p>
        <h1 className="text-3xl font-bold leading-tight tracking-tight text-ink sm:text-4xl">Politica de confidențialitate</h1>
        <p className="text-sm text-ink-faint">
          Ultima actualizare: {LAST_UPDATED} · Versiunea {VERSION}
        </p>
        <p className="text-base leading-relaxed text-ink-soft">
          Această politică explică modul în care {operatorName} prelucrează datele cu caracter personal ale utilizatorilor platformei de management al proiectelor de finanțare, în conformitate cu Regulamentul (UE) 2016/679 (GDPR) și cu Legea nr. 190/2018.
        </p>
      </header>

      <div className="grid gap-10 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <aside className="lg:order-none">
          <nav aria-label="Cuprins" className="lg:sticky lg:top-24">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-faint">Cuprins</p>
            <ol className="space-y-1.5 text-sm">
              {SECTIONS.map((section, index) => (
                <li key={section.id}>
                  <a href={`#${section.id}`} className="flex gap-2 text-ink-soft hover:text-ink">
                    <span className="w-5 shrink-0 tabular-nums text-ink-faint">{index + 1}.</span>
                    <span>{section.title}</span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </aside>

        <article className="max-w-3xl space-y-10 pb-8">
          <div className="rounded-[var(--radius-plate)] border border-rule bg-plate p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-faint">Pe scurt</h2>
            <ul className="list-disc space-y-1.5 pl-5 text-[15px] leading-relaxed text-ink-soft">
              <li>Prelucrăm datele doar pentru a gestiona proiectele de finanțare pentru care ne-ați contractat.</li>
              <li>Nu vindem datele, nu le folosim pentru publicitate și nu luăm decizii automate despre dumneavoastră.</li>
              <li>Copiile actelor de identitate și cazierele se șterg automat, la termene scurte.</li>
              <li>Datele sunt găzduite în Uniunea Europeană (Irlanda).</li>
              <li>Ne puteți scrie oricând la {email} pentru a vă exercita drepturile.</li>
            </ul>
          </div>

          <Section index={0}>
            <p>
              Operatorul datelor este <strong className="text-ink">{operatorName}</strong>, cod unic de înregistrare {operator.cui ?? <Missing what="CUI" />}, cu sediul în {operator.address ?? <Missing what="adresa sediului" />} (denumit în continuare „noi”).
            </p>
            <p>
              {operator.dpo
                ? <>Am desemnat un responsabil cu protecția datelor, pe care îl puteți contacta la: {operator.dpo}.</>
                : <>Pentru orice întrebare privind datele personale ne puteți contacta la {email}.</>}
            </p>
          </Section>

          <Section index={1}>
            <p>
              Pentru datele contului dumneavoastră, pentru relația contractuală și pentru jurnalul de securitate al platformei acționăm ca <strong className="text-ink">operator</strong>.
            </p>
            <p>
              Documentele încărcate în dosarul unui proiect de finanțare (de exemplu actele asociaților, ale reprezentanților legali sau ale angajaților beneficiarului) le prelucrăm în numele beneficiarului finanțării, clientul nostru, în calitate de <strong className="text-ink">persoană împuternicită</strong> (art. 28 GDPR). Le folosim exclusiv pentru pregătirea, depunerea și implementarea proiectului, potrivit contractului încheiat cu beneficiarul. Beneficiarul răspunde de informarea persoanelor ale căror documente ni le transmite.
            </p>
          </Section>

          <Section index={2}>
            <Table
              head={['Categorie', 'Exemple', 'Sursa']}
              rows={[
                ['Date de identificare și contact', 'nume, adresă de email, telefon, funcție', 'dumneavoastră sau angajatorul dumneavoastră'],
                ['Date despre firmă', 'denumire, CIF, adresa sediului, persoană de contact', 'dumneavoastră'],
                ['Date despre proiecte', 'titlu, coduri, termene, consultanți implicați, stadiu', 'generate în platformă'],
                ['Documentele dosarului', 'certificate, situații financiare, declarații, copii ale actelor de identitate, caziere', 'beneficiarul proiectului'],
                ['Comunicări', 'mesajele din discuțiile de proiect și conversațiile interne', 'utilizatorii platformei'],
                ['Date tehnice', 'acțiunile efectuate, adresa IP, tipul de browser, data și ora', 'generate automat'],
              ]}
            />
          </Section>

          <Section index={3}>
            <Table
              head={['Scop', 'Temei legal']}
              rows={[
                ['Crearea și administrarea contului, accesul la proiecte', 'executarea contractului — art. 6 alin. (1) lit. b) GDPR'],
                ['Pregătirea, depunerea și implementarea proiectului de finanțare', 'executarea contractului; pentru documentele din dosar, instrucțiunile beneficiarului și obligațiile sale legale față de finanțator'],
                ['Notificări și remindere privind termenele', 'executarea contractului — art. 6 alin. (1) lit. b) GDPR'],
                ['Jurnalul de securitate și trasabilitatea acțiunilor', 'interesul nostru legitim de a proteja datele și de a putea dovedi operațiunile efectuate — art. 6 alin. (1) lit. f) GDPR'],
                ['Păstrarea dosarului după încheierea proiectului', 'obligațiile legale ale beneficiarului privind controalele finanțatorului; constatarea, exercitarea sau apărarea unor drepturi în instanță'],
              ]}
            />
            <p>Nu folosim datele în scopuri de marketing, nu le vindem și nu realizăm profilări sau decizii individuale automatizate.</p>
          </Section>

          <Section index={4}>
            <p>
              Atunci când ghidul de finanțare o cere, dosarul poate conține copii ale actelor de identitate, care includ codul numeric personal (CNP), și certificate de cazier judiciar (date privind condamnări penale, art. 10 GDPR). Le prelucrăm doar în măsura în care sunt necesare dosarului și aplicăm garanțiile prevăzute de art. 4 din Legea nr. 190/2018:
            </p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>cererile care primesc astfel de documente sunt marcate în platformă, iar accesul este limitat la echipa proiectului;</li>
              <li>fiecare descărcare este înregistrată în jurnalul de securitate;</li>
              <li>certificatul de cazier se șterge automat la {CAZIER_DAYS_AFTER_APPROVAL} de zile de la aprobare sau la {DAYS_AFTER_PROJECT_CLOSURE} de zile de la încheierea proiectului, dacă aceasta intervine mai devreme;</li>
              <li>copiile actelor de identitate se șterg automat la {DAYS_AFTER_PROJECT_CLOSURE} de zile de la încheierea proiectului.</li>
            </ul>
            <p>Ștergerea poate fi amânată numai printr-o decizie motivată și înregistrată, de exemplu pe durata unui control al autorității de management.</p>
          </Section>

          <Section index={5}>
            <p>Datele sunt accesibile doar membrilor echipei proiectului și clientului proiectului, în limita rolului fiecăruia. Folosim următorii furnizori, care acționează ca persoane împuternicite, pe bază de contract:</p>
            <Table
              head={['Furnizor', 'Serviciu', 'Locul prelucrării']}
              rows={[
                ['Supabase Inc.', 'baza de date, autentificarea, stocarea fișierelor', 'Irlanda (UE)'],
                ['Vercel Inc.', 'găzduirea aplicației', 'Irlanda (UE)'],
                ['Resend Inc.', 'trimiterea emailurilor de notificare', 'Statele Unite'],
              ]}
            />
            <p>Datele pot fi comunicate autorităților publice doar atunci când legea ne obligă.</p>
          </Section>

          <Section index={6}>
            <p>
              Furnizorii de mai sus sunt companii cu sediul în Statele Unite. Orice transfer sau acces din afara Spațiului Economic European are loc în baza deciziei de adecvare privind cadrul UE–SUA de protecție a datelor (EU-U.S. Data Privacy Framework), pentru furnizorii certificați, și a clauzelor contractuale standard adoptate de Comisia Europeană (Decizia (UE) 2021/914).
            </p>
          </Section>

          <Section index={7}>
            <Table
              head={['Date', 'Perioada de păstrare']}
              rows={[
                ['Dosarul proiectului (documente, discuții, istoric)', '10 ani de la încheierea proiectului, pentru controalele finanțatorului și regulile privind ajutorul de stat'],
                ['Copii ale actelor de identitate și caziere', <a key="s" href="#sensibile" className={linkClass}>conform secțiunii 5</a>],
                ['Datele contului', 'pe durata colaborării și 3 ani după încheierea ei (termenul general de prescripție), apoi se anonimizează'],
                ['Notificări', '12 luni'],
                ['Jurnalul de securitate (adresă IP, browser)', '12 luni, apoi se pseudonimizează'],
                ['Copii de siguranță ale bazei de date', `${BACKUP_RETENTION_DAYS} zile`],
              ]}
            />
          </Section>

          <Section index={8}>
            <p>Aplicăm măsuri tehnice și organizatorice adecvate riscului (art. 32 GDPR), printre care:</p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>criptarea conexiunilor (HTTPS) și a datelor stocate;</li>
              <li>fișiere păstrate într-un spațiu privat, accesibile doar prin linkuri temporare;</li>
              <li>acces pe roluri, verificat la fiecare cerere, și conturi create doar de administrator;</li>
              <li>jurnal de audit care nu poate fi modificat;</li>
              <li>copii de siguranță zilnice ale bazei de date;</li>
              <li>obligații de confidențialitate pentru personalul care are acces la date.</li>
            </ul>
            <p>În cazul unei încălcări a securității datelor, notificăm autoritatea de supraveghere în cel mult 72 de ore și persoanele afectate, atunci când riscul pentru ele este ridicat.</p>
          </Section>

          <Section index={9}>
            <p>În condițiile prevăzute de GDPR, aveți următoarele drepturi:</p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li><strong className="text-ink">dreptul de acces</strong> — să aflați ce date prelucrăm și să primiți o copie a lor;</li>
              <li><strong className="text-ink">dreptul la rectificare</strong> — să corectăm datele inexacte sau incomplete;</li>
              <li><strong className="text-ink">dreptul la ștergere</strong> — atunci când datele nu mai sunt necesare sau nu există un temei legal pentru păstrarea lor;</li>
              <li><strong className="text-ink">dreptul la restricționarea prelucrării</strong>;</li>
              <li><strong className="text-ink">dreptul la portabilitate</strong> — să primiți datele într-un format structurat, folosit în mod curent;</li>
              <li><strong className="text-ink">dreptul la opoziție</strong> — față de prelucrările bazate pe interesul legitim.</li>
            </ul>
            <p>
              Cererile se trimit la {email}. Răspundem fără întârzieri nejustificate și în cel mult o lună de la primire, termen care poate fi prelungit cu încă două luni pentru cereri complexe, cu informarea dumneavoastră. Exercitarea drepturilor este gratuită. Pentru documentele din dosarul unui proiect, cererea este transmisă și beneficiarului, în calitatea sa de operator.
            </p>
            <p>
              Aveți dreptul să depuneți o plângere la Autoritatea Națională de Supraveghere a Prelucrării Datelor cu Caracter Personal (ANSPDCP), B-dul G-ral. Gheorghe Magheru nr. 28-30, sector 1, București,{' '}
              <a className={linkClass} href="https://www.dataprotection.ro" target="_blank" rel="noopener noreferrer">www.dataprotection.ro</a>, precum și să vă adresați instanței competente.
            </p>
          </Section>

          <Section index={10}>
            <p>
              Platforma folosește doar elemente strict necesare funcționării serviciului solicitat de dumneavoastră. Nu folosim cookie-uri de analiză, de publicitate sau ale unor terți; de aceea nu vă cerem consimțământul (art. 4 alin. (6) din Legea nr. 506/2004).
            </p>
            <Table
              head={['Nume', 'Tip', 'Scop', 'Durată']}
              rows={[
                ['sb-…-auth-token', 'stocare locală', 'menține sesiunea de autentificare', 'până la deconectare'],
                ['bonie-recovery-…', 'cookie', 'confirmă resetarea parolei', '24 de ore'],
                ['bonie:recovery-attempt', 'stocare de sesiune', 'încercarea curentă de resetare a parolei', 'până la închiderea filei'],
                ['home:view, home:sort, bonie:*, drive-view:*', 'stocare locală / de sesiune', 'preferințele de afișare alese de dumneavoastră', 'până le ștergeți din browser'],
              ]}
            />
          </Section>

          <Section index={11}>
            <p>
              Putem actualiza această politică atunci când se schimbă serviciul sau legislația. Versiunea în vigoare și data ultimei actualizări apar la începutul documentului. Modificările importante le comunicăm clienților prin email înainte de a intra în vigoare.
            </p>
          </Section>

          <Section index={12}>
            <div className="rounded-[var(--radius-plate)] border border-rule bg-plate p-5 text-[15px] leading-relaxed">
              <p className="font-semibold text-ink">{operatorName}</p>
              <p>{operator.address ?? <Missing what="adresa sediului" />}</p>
              <p>CUI: {operator.cui ?? <Missing what="CUI" />}</p>
              <p>Email: {email}</p>
              {operator.dpo && <p>Responsabil cu protecția datelor: {operator.dpo}</p>}
            </div>
          </Section>
        </article>
      </div>
    </div>
  )
}
