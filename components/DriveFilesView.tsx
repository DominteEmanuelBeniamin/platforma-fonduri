'use client'

/**
 * Punctul de intrare al vederii Drive. Fișierul ținea 1.117 linii cu tot cu
 * cele două vederi; acum alege între ele și re-exportă tipurile, ca importurile
 * din restul aplicației să rămână neschimbate.
 */
import LogicalDriveFilesView from './drive/LogicalDriveFilesView'
import FlatDriveFilesView from './drive/FlatDriveFilesView'

export type {
  DriveAsset,
  DriveDocStatus,
  DriveDocument,
  DriveFolder,
  DriveVersion,
  DriveRow,
  DriveFolderChange,
} from './drive/types'

import type { DriveFilesViewProps } from './drive/types'

export default function DriveFilesView(props: DriveFilesViewProps) {
  if (props.documents !== undefined) {
    return (
      <LogicalDriveFilesView
        documents={props.documents}
        folders={props.folders}
        apiFetch={props.apiFetch}
        storageKey={props.storageKey}
        activeFolderId={props.activeFolderId}
        onFolderChange={props.onFolderChange}
        error={props.error}
        onRetry={props.onRetry}
      />
    )
  }

  return (
    <FlatDriveFilesView
      rows={props.rows}
      secondaryColumnLabel={props.secondaryColumnLabel}
      apiFetch={props.apiFetch}
      emptyText={props.emptyText}
      standalone={props.standalone}
    />
  )
}
