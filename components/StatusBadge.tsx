'use client'

import { Signal } from '@/components/ui/Signal'
import { requestStatusInfo, type RequestStatus } from '@/lib/request-status'

type StatusType = RequestStatus

interface StatusBadgeProps {
  status: StatusType | string
}

/**
 * Starea unei cereri de documente, din dicționarul comun (#109). Avea propriul
 * tabel, cu revenire pe „De încărcat" pentru orice valoare necunoscută — deci
 * și pentru o cerere închisă.
 */
export default function StatusBadge({ status }: StatusBadgeProps) {
  const info = requestStatusInfo(status)
  return <Signal tone={info.tone}>{info.label}</Signal>
}

export type { StatusType }
