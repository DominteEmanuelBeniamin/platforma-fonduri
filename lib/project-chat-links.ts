import type { SearchResult } from './projectSearch'

export type ProjectChatLinkReference =
  | {
      type: 'phase'
      id: string
      projectId: string
      phaseId: string
    }
  | {
      type: 'activity'
      id: string
      projectId: string
      phaseId: string
      activityId: string
    }
  | {
      type: 'document_request'
      id: string
      projectId: string
      requestId: string
      phaseId: string
      activityId: string | null
    }

export type ParsedProjectChatLink = {
  href: string
  text: string
  start: number
  end: number
  reference: ProjectChatLinkReference
}

type ParsedHref = Omit<ParsedProjectChatLink, 'text' | 'start' | 'end'>

const PROJECTS_PREFIX = '/projects/'
const GENERAL_PHASE_ID = '__general__'
const UNRESOLVED_LINK_TEXT = 'Element indisponibil'

function isSafeIdentifier(value: string): boolean {
  return /^[A-Za-z0-9_](?:[A-Za-z0-9._~-]{0,255})$/.test(value)
}

function decode(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

function queryValues(url: URL): Map<string, string> | null {
  const values = new Map<string, string>()
  for (const [key, value] of url.searchParams) {
    if (values.has(key)) return null
    values.set(key, value)
  }
  return values
}

/**
 * Parsează numai formele generate de `buildProjectChatHref`.
 * Orice URL absolut, malformed sau cu o combinație de parametri necunoscută
 * este tratat ca text simplu.
 */
export function parseProjectChatHref(
  href: unknown,
  projectId: string,
): ParsedHref | null {
  if (typeof href !== 'string' || !isSafeIdentifier(projectId)) return null
  if (!href.startsWith(PROJECTS_PREFIX) || href.startsWith('//') || href.includes('\\')) return null
  if (/[^\x20-\x7e]/.test(href)) return null

  const hashIndex = href.indexOf('#')
  const queryEnd = hashIndex === -1 ? href.length : hashIndex
  const queryIndex = href.indexOf('?')
  if (queryIndex !== -1 && queryIndex > queryEnd) return null

  const rawQuery = queryIndex === -1 ? '' : href.slice(queryIndex + 1, queryEnd)
  if (rawQuery && rawQuery.split('&').some(part => !part || !part.includes('='))) return null
  if (hashIndex !== -1 && href.slice(hashIndex) === '#') return null

  let url: URL
  try {
    url = new URL(href, 'https://project-chat.invalid')
  } catch {
    return null
  }
  if (url.origin !== 'https://project-chat.invalid') return null

  const pathname = url.pathname
  const pathParts = pathname.split('/')
  if (pathParts.length !== 3 || pathParts[0] !== '' || pathParts[1] !== 'projects' || !pathParts[2]) return null
  const decodedProjectId = decode(pathParts[2])
  if (decodedProjectId !== projectId || !isSafeIdentifier(decodedProjectId)) return null

  const values = queryValues(url)
  if (!values || !values.has('phase')) return null
  const phaseId = values.get('phase') ?? ''
  if (!isSafeIdentifier(phaseId)) return null

  const activityId = values.get('activity') ?? null
  const requestId = values.get('document') ?? null
  const keys = [...values.keys()]
  if (keys.some(key => key !== 'phase' && key !== 'activity' && key !== 'document')) return null
  if (activityId !== null && !isSafeIdentifier(activityId)) return null
  if (requestId !== null && !isSafeIdentifier(requestId)) return null

  const hash = url.hash
  if (phaseId === GENERAL_PHASE_ID) {
    if (activityId !== null || requestId === null || keys.length !== 2 || hash !== '#general-requests') {
      return null
    }
    return {
      href,
      reference: {
        type: 'document_request',
        id: requestId,
        projectId,
        requestId,
        phaseId: GENERAL_PHASE_ID,
        activityId: null,
      },
    }
  }

  if (keys.length === 1 && activityId === null && requestId === null && hash === '') {
    return {
      href,
      reference: { type: 'phase', id: phaseId, projectId, phaseId },
    }
  }

  if (activityId === null || hash !== `#activity-${activityId}`) return null

  if (requestId === null && keys.length === 2) {
    return {
      href,
      reference: { type: 'activity', id: activityId, projectId, phaseId, activityId },
    }
  }

  if (requestId !== null && keys.length === 3) {
    return {
      href,
      reference: {
        type: 'document_request',
        id: requestId,
        projectId,
        requestId,
        phaseId,
        activityId,
      },
    }
  }

  return null
}

function projectHref(projectId: string, params: Record<string, string>, hash = ''): string {
  const query = new URLSearchParams(params).toString()
  return `${PROJECTS_PREFIX}${encodeURIComponent(projectId)}?${query}${hash}`
}

/** Construiește href-ul canonic folosit de navigarea chatului de proiect. */
export function buildProjectChatHref(projectId: string, result: SearchResult): string {
  if (result.type === 'phase') {
    const phaseId = result.phaseId || result.id
    return isSafeIdentifier(projectId) && isSafeIdentifier(phaseId)
      ? projectHref(projectId, { phase: phaseId })
      : `${PROJECTS_PREFIX}${encodeURIComponent(projectId)}`
  }

  if (result.type === 'activity') {
    const phaseId = result.phaseId
    const activityId = result.activityId || result.id
    return isSafeIdentifier(projectId) && !!phaseId && isSafeIdentifier(phaseId) && isSafeIdentifier(activityId)
      ? projectHref(projectId, { phase: phaseId, activity: activityId }, `#activity-${encodeURIComponent(activityId)}`)
      : `${PROJECTS_PREFIX}${encodeURIComponent(projectId)}`
  }

  const requestId = result.id
  if (!isSafeIdentifier(projectId) || !isSafeIdentifier(requestId)) {
    return `${PROJECTS_PREFIX}${encodeURIComponent(projectId)}`
  }
  if (result.phaseId && result.activityId && isSafeIdentifier(result.phaseId) && isSafeIdentifier(result.activityId)) {
    return projectHref(
      projectId,
      { phase: result.phaseId, activity: result.activityId, document: requestId },
      `#activity-${encodeURIComponent(result.activityId)}`,
    )
  }
  return projectHref(projectId, { phase: GENERAL_PHASE_ID, document: requestId }, '#general-requests')
}

const LINK_TOKEN = /\/projects\/[^\s"'<>`]+/g
const TRAILING_PUNCTUATION = /[.,!?;:)\]}]+$/

/** Extrage doar tokenii relativi și validați; restul corpului rămâne text. */
export function extractProjectChatLinks(body: string, projectId: string): ParsedProjectChatLink[] {
  if (typeof body !== 'string') return []
  const links: ParsedProjectChatLink[] = []

  for (const match of body.matchAll(LINK_TOKEN)) {
    const start = match.index ?? 0
    const before = body[start - 1]
    if (before && (/[A-Za-z0-9._~%/-]/.test(before) || before === ':' || before === '\\')) continue

    let token = match[0]
    while (TRAILING_PUNCTUATION.test(token)) token = token.slice(0, -1)
    if (!token) continue

    const parsed = parseProjectChatHref(token, projectId)
    if (!parsed) continue
    links.push({
      ...parsed,
      text: body.slice(start, start + token.length),
      start,
      end: start + token.length,
    })
  }
  return links
}

export type ProjectChatBodySegment =
  | { kind: 'text'; text: string }
  | { kind: 'link'; text: string; href: string; reference: ProjectChatLinkReference }

/** Împarte corpul fără să piardă caractere, inclusiv pentru linkuri repetate. */
export function splitProjectChatBody(body: string, projectId: string): ProjectChatBodySegment[] {
  const links = extractProjectChatLinks(body, projectId)
  if (links.length === 0) return body ? [{ kind: 'text', text: body }] : []

  const segments: ProjectChatBodySegment[] = []
  let cursor = 0
  for (const link of links) {
    if (link.start > cursor) segments.push({ kind: 'text', text: body.slice(cursor, link.start) })
    segments.push({ kind: 'link', text: link.text, href: link.href, reference: link.reference })
    cursor = link.end
  }
  if (cursor < body.length) segments.push({ kind: 'text', text: body.slice(cursor) })
  return segments
}

export { GENERAL_PHASE_ID, UNRESOLVED_LINK_TEXT }
