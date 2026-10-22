import type { Metadata } from 'next'
import Link from 'next/link'
import { privacyOperator } from '@/lib/privacy-operator'
import { CAZIER_DAYS_AFTER_APPROVAL, DAYS_AFTER_PROJECT_CLOSURE } from '@/lib/sensitive-documents'
import { BACKUP_RETENTION_DAYS } from '@/lib/db-backup'

export const metadata: Metadata = {
  title: 'Confidențialitate',
  description: 'Cum prelucrăm datele personale în platforma de proiecte de finanțare.',
}

const VERSION = 'Versiunea 1 · în vigoare din 22 octombrie 2026'

function Missing({ what }: { what: string }) {
  return <span className="rounded-[var(--radius-plate)] bg-[var(--sg-warn-soft)] px-1 text-[var(--sg-warn)]">[de completat: {what}]</span>
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-titlu`} className="space-y-3 border-t border-rule pt-6">
      <h2 id={`${id}-titlu`} className="text-lg font-bold text-ink">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-ink-soft">{children}</div>
    </section>
  )
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
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
          {rows.map(row => (
            <tr key={row[0]} className="align-top">
              {row.map((cell, index) => (
                <td key={index} className={`border-b border-rule px-3 py-2 last:border-b-0 ${index === 0 ? 'font-semibold text-ink' : 'text-ink-soft'}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Informarea de confidențialitate (art. 13–14 GDPR). Publică: o citește și
 * cine nu are încă cont. Datele firmei vin din `lib/privacy-operator.ts`.
 * Textul e prima variantă și se validează de un avocat pe protecția datelor.
 */
export default function PrivacyPage() {
  const operator = privacyOperator()
  const contact = operator.email ?? null

  return (
    <article className="mx-auto max-w-3xl space-y-6 pt-10">
      <header className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{VERSION}</p>
        <h1 className="text-3xl font-bold leading-tight text-ink">Informare privind confidențialitatea</h1>
        <p className="text-base leading-relaxed text-ink-soft">
          Platforma ține evidența proiectelor de finanțare: fazele, documentele cerute, termenele, discuțiile și jurnalul de acțiuni. Mai jos găsești ce date personale prelucrăm, de ce, cât le păstrăm și ce drepturi ai.
        </p>
        <p className="text-sm">
          <Link href="/" className="font-semibold text-[var(--sg-accent-ink)] underline underline-offset-4">Înapoi la aplicație</Link>
        </p>
      </header>

      <Section id="operator" title="Cine răspunde de date">
        <p>
          Operatorul este <strong className="text-ink">{operator.name ?? <Missing what="denumirea firmei" />}</strong>
          {', '}CUI {operator.cui ?? <Missing what="CUI" />}, cu sediul în {operator.address ?? <Missing what="adresa sediului" />}.
        </p>
        <p>
          Pentru orice întrebare sau cerere despre datele tale scrie la {contact ? <a className="font-semibold text-[var(--sg-accent-ink)] underline underline-offset-4" href={`mailto:${contact}`}>{contact}</a> : <Missing what="adresa de email" />}.
          {operator.dpo && <> Responsabilul cu protecția datelor: {operator.dpo}.</>}
        </p>
        <p>
          Pentru documentele din dosarul de finanțare (de exemplu actele asociaților sau ale angajaților), le prelucrăm în numele clientului nostru, beneficiarul finanțării, și doar pentru pregătirea și implementarea proiectului, conform contractului cu el.
        </p>
      </Section>

      <Section id="date" title="Ce date prelucrăm">
        <ul className="list-disc space-y-1 pl-5">
          <li><strong className="text-ink">Date de cont:</strong> nume, email, telefon, firmă, CIF, adresa firmei, rol.</li>
          <li><strong className="text-ink">Date despre proiecte:</strong> titlu, coduri, persoane de contact, termene, consultanții implicați.</li>
          <li><strong className="text-ink">Documentele încărcate</strong> și ce conțin, inclusiv, când ghidul finanțării le cere, copii ale actelor de identitate (cu CNP) și caziere judiciare.</li>
          <li><strong className="text-ink">Mesaje</strong> din discuțiile de proiect și din conversațiile interne.</li>
          <li><strong className="text-ink">Date tehnice:</strong> acțiunile făcute în platformă, adresa IP și tipul de browser, păstrate în jurnalul de securitate.</li>
        </ul>
      </Section>

      <Section id="scopuri" title="De ce le prelucrăm">
        <Table
          head={['Scop', 'Temei legal (GDPR)']}
          rows={[
            ['Contul tău și accesul la proiecte', 'executarea contractului, art. 6 alin. (1) lit. b)'],
            ['Pregătirea și implementarea proiectului de finanțare', 'executarea contractului; pentru documentele din dosar, instrucțiunile beneficiarului și obligațiile lui legale față de finanțator'],
            ['Notificări și remindere despre termene', 'executarea contractului'],
            ['Jurnalul de securitate și dovada acțiunilor', 'interesul legitim de a proteja datele și de a putea arăta cine ce a făcut, art. 6 alin. (1) lit. f)'],
            ['Păstrarea dosarului după încheierea proiectului', 'obligațiile beneficiarului privind controalele finanțatorului și apărarea unor drepturi în instanță'],
          ]}
        />
        <p>Nu folosim datele pentru marketing, nu le vindem și nu luăm decizii automate despre tine.</p>
      </Section>

      <Section id="sensibile" title="Copii ale actelor de identitate și caziere">
        <p>
          Aceste documente se cer doar când ghidul finanțării le cere și se folosesc doar pentru dosar. Cererile care le primesc sunt marcate în platformă, iar fișierele lor se șterg automat:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>cazierul judiciar, la {CAZIER_DAYS_AFTER_APPROVAL} de zile după ce îl aprobăm, sau la {DAYS_AFTER_PROJECT_CLOSURE} de zile după încheierea proiectului, dacă aceasta vine mai devreme;</li>
          <li>copia actului de identitate, la {DAYS_AFTER_PROJECT_CLOSURE} de zile după încheierea proiectului.</li>
        </ul>
        <p>Ștergerea se poate amâna doar printr-o decizie motivată, de exemplu pe durata unui control al finanțatorului.</p>
      </Section>

      <Section id="destinatari" title="Cine mai are acces la date">
        <p>Datele le văd doar persoanele din echipa proiectului și clientul proiectului, fiecare cât îi permite rolul. Platforma folosește furnizori care prelucrează datele în numele nostru, pe bază de contract:</p>
        <Table
          head={['Furnizor', 'Ce face', 'Unde']}
          rows={[
            ['Supabase Inc.', 'baza de date, conturile, fișierele', 'Irlanda (UE)'],
            ['Vercel Inc.', 'găzduirea aplicației', 'Irlanda (UE); firma e din SUA'],
            ['Resend Inc.', 'trimiterea emailurilor', 'SUA'],
          ]}
        />
        <p>
          Când datele ajung în SUA sau sunt accesibile de acolo, transferul se face pe baza cadrului UE–SUA privind protecția datelor (Data Privacy Framework), la care Vercel și Resend sunt certificate, și a clauzelor contractuale standard aprobate de Comisia Europeană.
        </p>
        <p>Autoritățile primesc date doar când legea o cere.</p>
      </Section>

      <Section id="pastrare" title="Cât păstrăm datele">
        <Table
          head={['Date', 'Cât le păstrăm']}
          rows={[
            ['Dosarul proiectului (documente, discuții)', '10 ani de la încheierea proiectului, cât cer controalele și regulile de ajutor de stat'],
            ['Copii de buletin și caziere', 'vezi secțiunea de mai sus'],
            ['Contul tău', 'cât durează colaborarea, plus 3 ani (termenul general de prescripție), apoi se anonimizează'],
            ['Notificări', '12 luni'],
            ['Copiile de siguranță ale bazei de date', `${BACKUP_RETENTION_DAYS} zile`],
          ]}
        />
      </Section>

      <Section id="browser" title="Cookie-uri și stocare în browser">
        <p>
          Folosim doar ce e strict necesar ca aplicația să funcționeze: sesiunea de autentificare, preferințele de afișare (de exemplu vederea aleasă) și un cookie temporar, de 24 de ore, la resetarea parolei. Nu folosim cookie-uri de analiză sau de publicitate, de aceea nu îți cerem acordul pentru ele (Legea 506/2004, art. 4 alin. (6)).
        </p>
      </Section>

      <Section id="securitate" title="Cum protejăm datele">
        <p>
          Fișierele stau într-un spațiu privat și se descarcă doar prin linkuri temporare, de cei care au acces la proiect. Fiecare acțiune importantă, inclusiv fiecare descărcare, intră într-un jurnal care nu se poate modifica. Conexiunile sunt criptate, iar conturile le creează doar administratorul.
        </p>
      </Section>

      <Section id="drepturi" title="Drepturile tale">
        <p>Poți cere oricând:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>o copie a datelor tale (dreptul de acces);</li>
          <li>corectarea datelor greșite;</li>
          <li>ștergerea datelor, când nu mai există un motiv legal să le păstrăm;</li>
          <li>restricționarea prelucrării sau opoziția față de ea;</li>
          <li>datele tale într-un format pe care îl poți folosi în altă parte (portabilitate).</li>
        </ul>
        <p>
          Scrie la {contact ?? <Missing what="adresa de email" />}. Răspundem în cel mult o lună, gratuit. Pentru documentele din dosarul de finanțare, cererea ajunge și la beneficiarul proiectului, care decide asupra lor.
        </p>
        <p>
          Dacă nu ești mulțumit de răspuns, poți depune o plângere la Autoritatea Națională de Supraveghere a Prelucrării Datelor cu Caracter Personal (ANSPDCP), B-dul G-ral. Gheorghe Magheru nr. 28-30, sector 1, București,{' '}
          <a className="font-semibold text-[var(--sg-accent-ink)] underline underline-offset-4" href="https://www.dataprotection.ro" target="_blank" rel="noopener noreferrer">www.dataprotection.ro</a>.
        </p>
      </Section>

      <Section id="modificari" title="Modificări">
        <p>Când informarea se schimbă, actualizăm versiunea de sus și anunțăm clienții pe email dacă schimbarea îi privește.</p>
      </Section>
    </article>
  )
}
