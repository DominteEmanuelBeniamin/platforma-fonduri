import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Confidențialitate | Bonie',
  description: 'Informații despre datele prelucrate în platforma Bonie.',
}

const requiredConfig = [
  ['NEXT_PUBLIC_PRIVACY_OPERATOR_NAME', process.env.NEXT_PUBLIC_PRIVACY_OPERATOR_NAME?.trim()],
  ['NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL', process.env.NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL?.trim()],
  ['NEXT_PUBLIC_PRIVACY_CONTACT_ADDRESS', process.env.NEXT_PUBLIC_PRIVACY_CONTACT_ADDRESS?.trim()],
  ['NEXT_PUBLIC_PRIVACY_SUPERVISORY_AUTHORITY_NAME', process.env.NEXT_PUBLIC_PRIVACY_SUPERVISORY_AUTHORITY_NAME?.trim()],
  ['NEXT_PUBLIC_PRIVACY_SUPERVISORY_AUTHORITY_URL', process.env.NEXT_PUBLIC_PRIVACY_SUPERVISORY_AUTHORITY_URL?.trim()],
] as const

const operatorName = requiredConfig[0][1]
const contactEmail = requiredConfig[1][1]
const contactAddress = requiredConfig[2][1]
const missingConfig = requiredConfig.filter(([, value]) => !value).map(([name]) => name)
const supervisoryAuthorityName = process.env.NEXT_PUBLIC_PRIVACY_SUPERVISORY_AUTHORITY_NAME?.trim()
const supervisoryAuthorityUrlValue = process.env.NEXT_PUBLIC_PRIVACY_SUPERVISORY_AUTHORITY_URL?.trim()

function validHttpUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

const supervisoryAuthorityUrl = validHttpUrl(supervisoryAuthorityUrlValue)
const invalidSupervisoryAuthorityUrl = Boolean(supervisoryAuthorityUrlValue && !supervisoryAuthorityUrl)

export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-4xl space-y-8 pb-8">
      <header className="space-y-3">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-indigo-600">Transparență</p>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Informare privind confidențialitatea</h1>
        <p className="max-w-3xl text-base leading-7 text-slate-600">
          Această informare descrie, pe scurt, ce date pot fi prelucrate când folosești platforma Bonie, de ce și ce opțiuni ai.
        </p>
        <p className="text-xs font-medium text-slate-500">Versiunea 1.0 · Data intrării în vigoare: 11 septembrie 2026</p>
      </header>

      {missingConfig.length > 0 && (
        <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-bold">Configurare necesară înainte de publicare</p>
          <p className="mt-1 leading-6">
            Lipsesc valorile obligatorii pentru identitatea și contactul operatorului: {missingConfig.join(', ')}. Nu afișăm date inventate; completați configurația înainte de utilizarea în producție.
          </p>
        </div>
      )}

      {invalidSupervisoryAuthorityUrl && (
        <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-bold">Configurație incompletă pentru autoritatea de supraveghere</p>
          <p className="mt-1 leading-6">
            NEXT_PUBLIC_PRIVACY_SUPERVISORY_AUTHORITY_URL trebuie să fie o adresă http:// sau https://; adresa configurată nu este afișată ca link.
          </p>
        </div>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-xl font-bold text-slate-900">Operator și contact</h2>
        <dl className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
          <div>
            <dt className="font-semibold text-slate-900">Operator</dt>
            <dd>{operatorName || 'Nu este configurat încă.'}</dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-900">Contact</dt>
            <dd>
              {contactEmail ? <a className="text-indigo-700 underline underline-offset-2" href={`mailto:${contactEmail}`}>{contactEmail}</a> : 'Nu este configurat încă.'}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-900">Adresă de contact</dt>
            <dd>{contactAddress || 'Nu este configurată încă.'}</dd>
          </div>
        </dl>
      </section>

      <section className="grid gap-6 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h2 className="text-xl font-bold text-slate-900">Ce date pot apărea</h2>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-600">
            <li>Date de identificare și contact: nume, email, telefon și organizație/CIF când sunt furnizate.</li>
            <li>Date de cont și autentificare: identificatori de cont și sesiune.</li>
            <li>Date despre proiecte și fluxul de lucru: proiecte, cereri, termene, roluri și statusuri.</li>
            <li>Conținut introdus de utilizatori: documente, nume de fișiere, descrieri, comentarii, mesaje și imagini din chat.</li>
            <li>Date de activitate și securitate: acțiuni relevante și informații tehnice necesare funcționării și protejării serviciului.</li>
          </ul>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h2 className="text-xl font-bold text-slate-900">De ce le folosim</h2>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-600">
            <li>Crearea și securizarea contului și controlul accesului.</li>
            <li>Gestionarea proiectelor, documentelor, cererilor și colaborării.</li>
            <li>Trimiterea notificărilor și comunicărilor necesare serviciului.</li>
            <li>Prevenirea abuzului, depanarea și menținerea securității.</li>
            <li>Îndeplinirea obligațiilor legale, când acestea se aplică.</li>
          </ul>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-xl font-bold text-slate-900">Categorii de temei</h2>
        <p className="mt-4 text-sm leading-6 text-slate-600">Temeiul concret depinde de operațiune și trebuie documentat pentru situația aplicabilă:</p>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-600">
          <li>executarea contractului sau demersuri la cererea utilizatorului, pentru funcțiile de bază ale platformei;</li>
          <li>interese legitime, de exemplu securitate, prevenirea abuzului și administrarea serviciului, după evaluarea necesară;</li>
          <li>obligații legale, când păstrarea sau divulgarea este impusă de lege;</li>
          <li>consimțământ, doar pentru o opțiune distinctă care îl cere în mod expres; nu îl prezentăm ca temei implicit pentru serviciul de bază.</li>
        </ul>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-xl font-bold text-slate-900">Documente, chat și furnizori</h2>
        <p className="mt-4 text-sm leading-6 text-slate-600">
          Încarcă numai documentele necesare proiectului și evită datele care nu sunt necesare. Platforma permite documente și imagini în zonele de proiect și mesaje în chat; conținutul poate include date personale și trebuie verificat înainte de încărcare.
        </p>
        <p className="mt-3 text-sm leading-6 text-slate-600">Configurația curentă a aplicației indică următorii furnizori:</p>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-600">
          <li><span className="font-semibold text-slate-900">Supabase</span> — autentificare, bază de date și stocare de fișiere.</li>
          <li><span className="font-semibold text-slate-900">Vercel</span> — găzduire, livrare și rularea aplicației.</li>
          <li><span className="font-semibold text-slate-900">Resend</span> — livrarea emailurilor tranzacționale și a notificărilor.</li>
        </ul>
        <p className="mt-4 text-sm leading-6 text-slate-600">
          În funcție de configurația contului și a furnizorului, datele pot fi prelucrate în afara Spațiului Economic European. Dacă are loc un astfel de transfer, trebuie folosit mecanismul aplicabil (de exemplu o decizie de adecvare sau garanții contractuale) și documentat înainte de producție.
        </p>
      </section>

      <section className="grid gap-6 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h2 className="text-xl font-bold text-slate-900">Păstrare</h2>
          <p className="mt-4 text-sm leading-6 text-slate-600">
            Păstrarea diferă pentru cont/profil, proiecte și documente, conversații, audit/notificări și backupuri. Perioada exactă sau criteriul aplicabil fiecărei categorii trebuie confirmat înainte de producție; nu afișăm valori inventate. La expirare, datele sunt șterse din sistemele active sau, după caz, anonimizate ireversibil. Copiile reziduale pot rămâne temporar în backupuri, conform termenului furnizorului, fără utilizare curentă. Obligațiile legale, litigiile sau o suspendare legală a ștergerii (legal hold) pot amâna acest rezultat.
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h2 className="text-xl font-bold text-slate-900">Securitate și minimizare</h2>
          <p className="mt-4 text-sm leading-6 text-slate-600">
            Limităm accesul după rol și folosim măsuri tehnice și organizatorice pentru protejarea conturilor, documentelor și jurnalelor. Te rugăm să trimiți doar ce este necesar și să redactezi CNP-ul, adresa, datele bancare, datele de sănătate și alte date inutile.
          </p>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-xl font-bold text-slate-900">Drepturile tale</h2>
        <p className="mt-4 text-sm leading-6 text-slate-600">
          Poți cere accesul, rectificarea, ștergerea, restricționarea prelucrării, portabilitatea sau te poți opune, în condițiile legii. Dacă o operațiune se bazează pe consimțământ, îl poți retrage pentru viitor. Trimite cererea la contactul configurat mai sus; putem cere informații rezonabile pentru verificarea identității. Răspundem fără întârzieri nejustificate și, în principiu, în termen de o lună de la primirea cererii; când legea permite o prelungire, te informăm.
        </p>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Ai și dreptul de a depune o plângere la autoritatea de supraveghere competentă.
          {' '}
          {supervisoryAuthorityName && supervisoryAuthorityUrl ? (
            <a className="text-indigo-700 underline underline-offset-2" href={supervisoryAuthorityUrl} target="_blank" rel="noreferrer">{supervisoryAuthorityName}</a>
          ) : supervisoryAuthorityUrl ? (
            <a className="text-indigo-700 underline underline-offset-2" href={supervisoryAuthorityUrl} target="_blank" rel="noreferrer">Pagina autorității configurată</a>
          ) : supervisoryAuthorityName ? (
            <span>{supervisoryAuthorityName} (adresa web nu este configurată sau nu este validă).</span>
          ) : (
            <span>Detaliile autorității nu sunt configurate încă.</span>
          )}
        </p>
      </section>
    </article>
  )
}
