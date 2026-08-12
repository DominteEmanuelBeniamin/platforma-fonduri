function activeFiles(files) {
  return (files || []).filter(file => !file?.deleted_at)
}

function latestVersionNumber(files) {
  const active = activeFiles(files)
  if (active.length === 0) return null

  return active.reduce((latest, file) => {
    const version = Number(file?.version_number)
    return Number.isFinite(version) && version > latest ? version : latest
  }, 0)
}

function filterFilesForClient(files) {
  const active = activeFiles(files)
  const latest = latestVersionNumber(active)
  return latest === null ? [] : active.filter(file => file.version_number === latest)
}

function isLatestFileVersion(file, allFiles) {
  const latest = latestVersionNumber(allFiles)
  return latest !== null && file?.version_number === latest
}

module.exports = {
  activeFiles,
  latestVersionNumber,
  filterFilesForClient,
  isLatestFileVersion,
}
