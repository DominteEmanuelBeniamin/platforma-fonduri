// Clientul vede o singură versiune a unui document: cea mai recentă nearhivată.

export interface VersionedFile {
  version_number?: number | null
  deleted_at?: string | null
}

export function activeFiles<T extends VersionedFile>(files?: T[] | null): T[] {
  return (files || []).filter(file => !file?.deleted_at)
}

export function latestVersionNumber(files?: VersionedFile[] | null): number | null {
  const active = activeFiles(files)
  if (active.length === 0) return null

  return active.reduce((latest, file) => {
    const version = Number(file?.version_number)
    return Number.isFinite(version) && version > latest ? version : latest
  }, 0)
}

export function filterFilesForClient<T extends VersionedFile>(files?: T[] | null): T[] {
  const active = activeFiles(files)
  const latest = latestVersionNumber(active)
  return latest === null ? [] : active.filter(file => file.version_number === latest)
}

export function isLatestFileVersion(
  file: VersionedFile | null | undefined,
  allFiles?: VersionedFile[] | null,
): boolean {
  const latest = latestVersionNumber(allFiles)
  return latest !== null && file?.version_number === latest
}
