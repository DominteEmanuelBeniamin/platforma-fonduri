import { AlertTriangle, Check, Clock, Eye, Minus, PenLine } from 'lucide-react'
import type { SignalTone } from '@/lib/signage'

/**
 * Iconița unei stări, desenată — nu o glifă de text pusă să pară iconiță.
 *
 * Fiecare ton are un semn propriu, cu aceeași grosime de linie, ca o plăcuță
 * goală să nu se mai citească drept „nimic aici”:
 *   depășit sau respins → triunghi de avertizare
 *   de verificat        → ochi, e treaba ta să te uiți
 *   la client           → ceas, aștepți pe altcineva
 *   aprobat             → bifă
 *   în lucru            → peniță, încă se scrie
 */
const ICOANE: Record<SignalTone, typeof Check> = {
  danger: AlertTriangle,
  warn: Eye,
  neutral: Clock,
  ok: Check,
  draft: PenLine,
}

export function ToneIcon({ tone, className = 'h-3 w-3' }: { tone: SignalTone; className?: string }) {
  const Icon = ICOANE[tone] ?? Minus
  return <Icon className={className} strokeWidth={2.25} aria-hidden="true" />
}
