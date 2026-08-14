// Clientul vede o singură versiune a unui document: cea mai recentă nearhivată.

export interface VersionedFile {
  version_number?: number | null
  deleted_at?: string | null
}

export function activeFiles<T extends VersionedFile>(files?: T[] | null): T[] {
  return (files || []).filter(file => !file?.deleted_at)
}

/** Numărul de versiune, sau null dacă lipsește ori nu e numeric. */
function versionOf(file: VersionedFile | null | undefined): number | null {
  if (file?.version_number === null || file?.version_number === undefined) return null
  const version = Number(file.version_number)
  return Number.isFinite(version) ? version : null
}

export function latestVersionNumber(files?: VersionedFile[] | null): number | null {
  let latest: number | null = null
  for (const file of activeFiles(files)) {
    const version = versionOf(file)
    if (version === null) continue
    if (latest === null || version > latest) latest = version
  }
  return latest
}

export function filterFilesForClient<T extends VersionedFile>(files?: T[] | null): T[] {
  const active = activeFiles(files)
  const latest = latestVersionNumber(active)
  return latest === null ? [] : active.filter(file => versionOf(file) === latest)
}

export function isLatestFileVersion(
  file: VersionedFile | null | undefined,
  allFiles?: VersionedFile[] | null,
): boolean {
  const latest = latestVersionNumber(allFiles)
  const version = versionOf(file)
  return latest !== null && version !== null && version === latest
}
