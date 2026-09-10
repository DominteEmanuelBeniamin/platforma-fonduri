'use client'

/**
 * Ajutoarele și piesele mici ale vederii Drive: extensii, iconițe de fișier,
 * previzualizare și plăcuțele de stare. Le folosesc amândouă vederile.
 */
import { FileText, FileSpreadsheet, Image as ImageIcon } from 'lucide-react'
import type { DriveRow, DriveAsset } from './types'
import { Signal } from '@/components/ui/Signal'
import type { SignalTone } from '@/lib/signage'

export function getExt(path: string) {
  const p = path.split('.')
  return p.length > 1 ? p[p.length - 1].toLowerCase() : ''
}

export function isImageExt(e: string) {
  return ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(e)
}

/**
 * Numele sub care se vede un lucru din Drive: cel scris de om, altfel ultima
 * bucată din calea din storage. Rândul și fișierul au aceleași câmpuri, deci
 * aceeași funcție — `getAssetDisplayName` e doar numele ei la locul de muncă.
 */
export function getDisplayName(item: { displayName?: string | null; storagePath: string }) {
  const displayName = item.displayName?.trim()
  if (displayName) return displayName
  return item.storagePath.split('/').filter(Boolean).pop() || 'fisier'
}

export const getAssetDisplayName = getDisplayName

/**
 * Tipul unui fișier e o clasificare, nu o stare: nu primește culoare de semnal.
 * Iconița îl spune deja — PDF, foaie de calcul, imagine, document — iar
 * culoarea rămâne neutră peste tot.
 */
export const FILE_TILE = { bg: 'var(--sg-paper-sunk)', icon: 'var(--sg-ink-soft)' } as const

export function FileIconDrive({ path, size = 'md' }: { path: string; size?: 'sm' | 'md' | 'lg' }) {
  const { bg, icon } = FILE_TILE
  const ext = getExt(path)
  const sizes = {
    sm: { wrap: 'w-8 h-8 rounded-lg',    ic: 'w-4 h-4' },
    md: { wrap: 'w-10 h-10 rounded-xl',  ic: 'w-5 h-5' },
    lg: { wrap: 'w-16 h-16 rounded-2xl', ic: 'w-8 h-8' },
  }
  const s = sizes[size]
  const IconComp = isImageExt(ext) ? ImageIcon
    : ['xls', 'xlsx', 'csv'].includes(ext) ? FileSpreadsheet
    : FileText
  return (
    <div className={`${s.wrap} flex items-center justify-center flex-shrink-0`} style={{ backgroundColor: bg }}>
      <IconComp className={s.ic} style={{ color: icon }} />
    </div>
  )
}

export function FilePreview({ path, previewUrl, size = 'md' }: { path: string; previewUrl?: string; size?: 'sm' | 'md' | 'lg' }) {
  const ext = getExt(path)
  if (isImageExt(ext) && previewUrl) {
    const sizes = { sm: 'w-8 h-8 rounded-lg', md: 'w-10 h-10 rounded-xl', lg: 'w-16 h-16 rounded-2xl' }
    return (
      <div className={`${sizes[size]} overflow-hidden flex-shrink-0 border`} style={{ borderColor: 'var(--sg-rule)' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={previewUrl} alt="" className="w-full h-full object-cover" />
      </div>
    )
  }
  return <FileIconDrive path={path} size={size} />
}

export function StatusPill({ status, label }: { status: DriveRow['docStatus']; label?: string }) {
  if (!status) return null
  // Culorile erau scrise hexa, dintr-o altă paletă. Acum vin din semnalele
  // sistemului, iar semnul e desenat, nu o bulină colorată.
  const map: Record<string, { label: string; tone: SignalTone }> = {
    approved: { label: 'Aprobat',            tone: 'ok' },
    rejected: { label: 'Respins',            tone: 'danger' },
    review:   { label: 'În verificare',      tone: 'warn' },
    pending:  { label: 'În așteptare',       tone: 'neutral' },
    sent:     { label: 'Trimis clientului',  tone: 'neutral' },
  }
  const c = map[status as string] ?? map.pending
  return <Signal tone={c.tone}>{label ?? c.label}</Signal>
}

export function PublicationPill({ reason }: { reason?: string }) {
  return (
    <span
      title={reason || 'Documentul nu este publicat'}
      aria-label={reason || 'Documentul nu este publicat'}
      className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full border border-[var(--sg-warn)] bg-[var(--sg-warn-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--sg-warn)]"
    >
      Nepublicat
    </span>
  )
}

export function assetActionId(asset: DriveAsset) {
  return asset.downloadKind === 'requestAttachment'
    ? `attachment-${asset.requestId}-${asset.attachmentId || asset.id}`
    : asset.fileId || asset.id
}
