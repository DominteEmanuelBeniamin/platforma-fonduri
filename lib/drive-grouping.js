function getStorageDisplayName(path) {
  if (!path) return undefined
  return path.split('/').filter(Boolean).pop() || undefined
}

function latestDate(values, fallback) {
  const valid = values.filter(Boolean).sort((a, b) => new Date(b).getTime() - new Date(a).getTime())
  return valid[0] || fallback
}

function getPublication(request, phase) {
  const blockers = []
  if (request.visibility !== 'published') blockers.push('cererea')

  if (request.activity_id || request.activity) {
    if (request.activity?.visibility !== 'published') blockers.push('activitatea')
    const phaseVisibility = request.activity?.phase?.visibility ?? phase?.visibility
    if (phaseVisibility !== 'published') blockers.push('faza')
  }

  return blockers.length === 0
    ? { status: 'published', reason: '' }
    : { status: 'unpublished', reason: `Nepublicat: ${blockers.join(', ')}` }
}

function buildDriveDocuments(requests = [], phases = []) {
  const phaseById = new Map(phases.map(phase => [phase.id, phase]))

  return requests.flatMap(request => {
    const phaseId = request.activity?.phase_id ?? null
    const phase = phaseId ? phaseById.get(phaseId) : undefined
    const folderId = phase ? `phase:${phase.id}` : 'general'
    const folderName = phase?.name ?? 'General'
    const folderOrderIndex = phase?.order_index ?? Number.MAX_SAFE_INTEGER
    const publication = getPublication(request, phase)

    const attachmentRows = request.attachments?.length
      ? request.attachments
      : request.attachment_path
      ? [{
          id: `${request.id}_legacy`,
          storage_path: request.attachment_path,
          original_name: request.attachment_original_name || null,
          missing_at: request.attachment_missing_at,
        }]
      : []

    const attachments = attachmentRows
      .filter(attachment => !attachment.missing_at)
      .map((attachment, index) => ({
        id: `${request.id}_attachment_${attachment.id || index}`,
        requestId: request.id,
        attachmentId: attachment.id,
        downloadKind: 'requestAttachment',
        storagePath: attachment.storage_path,
        displayName: attachment.original_name || getStorageDisplayName(attachment.storage_path) || 'Model document',
        uploadedAt: request.created_at,
        entryLabel: request.is_outgoing ? 'Document trimis clientului' : 'Model/atașament cerere',
      }))

    const versionsByNumber = new Map()
    for (const file of (request.files ?? [])) {
      if (file.deleted_at) continue
      const assets = versionsByNumber.get(file.version_number) ?? []
      assets.push({
        id: `${request.id}_${file.id}`,
        fileId: file.id,
        requestId: request.id,
        downloadKind: 'file',
        storagePath: file.storage_path,
        displayName: file.original_name,
        versionNumber: file.version_number,
        uploadedAt: file.created_at,
        entryLabel: 'Fișier încărcat',
      })
      versionsByNumber.set(file.version_number, assets)
    }

    const versions = Array.from(versionsByNumber.entries())
      .sort(([a], [b]) => b - a)
      .map(([version, assets]) => ({
        version,
        assets,
        createdAt: latestDate(assets.map(asset => asset.uploadedAt), request.created_at),
      }))

    if (attachments.length === 0 && versions.length === 0) return []

    return [{
      id: request.id,
      requestId: request.id,
      docName: request.name,
      docStatus: request.is_outgoing ? 'sent' : request.status,
      publicationStatus: publication.status,
      publicationReason: publication.reason,
      folderId,
      folderName,
      folderOrderIndex,
      activityName: request.activity?.name,
      uploadedAt: latestDate([
        ...attachments.map(asset => asset.uploadedAt),
        ...versions.flatMap(version => version.assets.map(asset => asset.uploadedAt)),
      ], request.created_at),
      attachments,
      versions,
    }]
  })
}

function buildDriveFolders(documents = [], phases = []) {
  const countByFolder = new Map()
  documents.forEach(document => {
    countByFolder.set(document.folderId, (countByFolder.get(document.folderId) ?? 0) + 1)
  })

  const phaseFolders = [...phases]
    .sort((a, b) => a.order_index - b.order_index || a.id.localeCompare(b.id))
    .map(phase => ({
      id: `phase:${phase.id}`,
      name: phase.name,
      documentCount: countByFolder.get(`phase:${phase.id}`) ?? 0,
    }))

  if (countByFolder.has('general')) {
    phaseFolders.push({
      id: 'general',
      name: 'General',
      documentCount: countByFolder.get('general') ?? 0,
    })
  }

  return phaseFolders
}

module.exports = { buildDriveDocuments, buildDriveFolders }
