import Link from 'next/link'

/**
 * Subsolul cu linkurile juridice, pe toate paginile, ca pe orice site:
 * discret, sub conținut, nu în bara de navigare.
 */
export default function LegalFooter() {
  return (
    <footer className="border-t border-rule">
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-2 px-4 py-5 text-xs text-ink-faint sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-10">
        <p>© {new Date().getFullYear()} Kabinet. Toate drepturile rezervate.</p>
        <nav aria-label="Informații juridice" className="flex flex-wrap gap-x-5 gap-y-1">
          <Link href="/confidentialitate" className="hover:text-ink hover:underline underline-offset-4">Politica de confidențialitate</Link>
          <Link href="/confidentialitate#cookie-uri" className="hover:text-ink hover:underline underline-offset-4">Cookie-uri</Link>
          <Link href="/confidentialitate#drepturi" className="hover:text-ink hover:underline underline-offset-4">Drepturile dumneavoastră</Link>
        </nav>
      </div>
    </footer>
  )
}
