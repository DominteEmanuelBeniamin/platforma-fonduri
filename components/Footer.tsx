import Link from 'next/link'

export default function Footer() {
  return (
    <footer className="relative z-10 border-t border-slate-200/80 bg-white/70 px-6 py-5 text-center text-xs text-slate-500 lg:px-12">
      <Link href="/confidentialitate" className="font-medium text-slate-600 underline-offset-4 hover:text-indigo-600 hover:underline">
        Confidențialitate
      </Link>
    </footer>
  )
}
