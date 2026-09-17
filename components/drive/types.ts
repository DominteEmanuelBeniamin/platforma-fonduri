/**
 * Tipurile publice ale vederii Drive. Au stat în `DriveFilesView.tsx`, care
 * ajunsese la 1.117 linii; aici le pot importa și cele două vederi desprinse,
 * fără import circular.
 */
// ── Public types ──────────────────────────────────────────────────────────────

import type {
  DriveAsset,
  DriveDocStatus,
  DriveDocument,
  DriveFolder,
  DriveVersion,
} from '@/lib/drive-grouping'

export type { DriveAsset, DriveDocStatus, DriveDocument, DriveFolder, DriveVersion }

export interface DriveRow {
  id: string           // unique row key
  fileId?: string      // used for file download + image preview API
  requestId?: string   // used for request attachment download
  downloadKind?: 'file' | 'requestAttachment'
  storagePath: string  // determines file type icon + image detection
  displayName?: string
  versionNumber?: number
  uploadedAt: string

  docName: string
  entryLabel?: string
  docStatus: DriveDocStatus

  // optional secondary column (phase or project)
  secondaryMain?: string      // bold line
  secondarySub?: string       // dimmer sub-line
  onSecondaryClick?: () => void

  // optional row click (e.g. open request modal)
  onRowClick?: () => void
}

/**
 * `folderId === null` înseamnă „ieși din dosar".
 * `mode: 'correct'` e navigare corectivă (folder inexistent în URL) și trebuie
 * să folosească `replace`, ca să nu bage o intrare în istoric peste care Back
 * s-ar întoarce la loc.
 */
export type DriveFolderChange = (folderId: string | null, mode?: 'navigate' | 'correct') => void

export interface DriveCommonProps {
  apiFetch: (url: string, opts?: RequestInit) => Promise<Response>
}

/** Vederea pe dosare, folosită în pagina de proiect. */
export interface DriveLogicalProps extends DriveCommonProps {
  documents: DriveDocument[]
  folders: DriveFolder[]
  storageKey?: string
  activeFolderId?: string | null
  onFolderChange?: DriveFolderChange
  error?: string | null
  onRetry?: () => void

  rows?: never
  secondaryColumnLabel?: never
  emptyText?: never
  standalone?: never
}

/** Vederea plată, folosită în pagina de utilizator. */
export interface DriveFlatProps extends DriveCommonProps {
  rows: DriveRow[]
  secondaryColumnLabel?: string
  emptyText?: string
  /**
   * standalone=true  → no fixed height, page-level scroll (user page)
   * standalone=false → flex h-full with internal overflow (panel inside project)
   */
  standalone?: boolean

  documents?: never
  folders?: never
  storageKey?: never
  activeFolderId?: never
  onFolderChange?: never
  error?: never
  onRetry?: never
}

/**
 * Union discriminat pe `documents`: props-urile unei ramuri nu mai pot fi
 * pasate celeilalte, unde ar fi fost ignorate în tăcere.
 */
export type DriveFilesViewProps = DriveLogicalProps | DriveFlatProps

// ── Internal types ────────────────────────────────────────────────────────────

export type SortKey = 'name' | 'secondary' | 'status' | 'date'
export type SortDir = 'asc' | 'desc'
export type ViewMode = 'list' | 'grid'

// ── Helpers ───────────────────────────────────────────────────────────────────
