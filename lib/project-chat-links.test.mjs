import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildProjectChatHref,
  extractProjectChatLinks,
  parseProjectChatHref,
  splitProjectChatBody,
} from './project-chat-links.ts'
import { maskProjectChatBodiesFromVisibilityMaps } from '../app/api/_utils/project-chat-links.ts'

const result = (type, overrides = {}) => ({
  id: 'r1',
  type,
  title: 'Element',
  description: null,
  phaseId: null,
  phaseName: null,
  activityId: null,
  activityName: null,
  status: null,
  ...overrides,
})

test('construiește cele patru href-uri canonice', () => {
  assert.equal(buildProjectChatHref('p1', result('phase', { id: 'p1-phase', phaseId: 'p1-phase' })), '/projects/p1?phase=p1-phase')
  assert.equal(
    buildProjectChatHref('p1', result('activity', { id: 'a1', phaseId: 'p1-phase', activityId: 'a1' })),
    '/projects/p1?phase=p1-phase&activity=a1#activity-a1',
  )
  assert.equal(
    buildProjectChatHref('p1', result('document_request', { id: 'r1', phaseId: 'p1-phase', activityId: 'a1' })),
    '/projects/p1?phase=p1-phase&activity=a1&document=r1#activity-a1',
  )
  assert.equal(
    buildProjectChatHref('p1', result('document_request', { id: 'general-r1' })),
    '/projects/p1?phase=__general__&document=general-r1#general-requests',
  )
})

test('parsează href-urile canonice și păstrează referința', () => {
  const parsed = parseProjectChatHref('/projects/p1?phase=f1&activity=a1&document=r1#activity-a1', 'p1')
  assert.deepEqual(parsed?.reference, {
    type: 'document_request',
    id: 'r1',
    projectId: 'p1',
    requestId: 'r1',
    phaseId: 'f1',
    activityId: 'a1',
  })
  assert.deepEqual(
    parseProjectChatHref('/projects/p1?phase=__general__&document=r1#general-requests', 'p1')?.reference,
    {
      type: 'document_request',
      id: 'r1',
      projectId: 'p1',
      requestId: 'r1',
      phaseId: '__general__',
      activityId: null,
    },
  )
})

test('split păstrează exact textul și linkurile repetate', () => {
  const body = 'Început /projects/p1?phase=f1 apoi /projects/p1?phase=f1. final'
  const segments = splitProjectChatBody(body, 'p1')
  assert.equal(segments.map(segment => segment.text).join(''), body)
  assert.deepEqual(segments.filter(segment => segment.kind === 'link').map(segment => segment.href), [
    '/projects/p1?phase=f1',
    '/projects/p1?phase=f1',
  ])
})

test('absolute, externe, malformate și alt proiect rămân text simplu', () => {
  const body = [
    'https://evil.example/projects/p1?phase=f1',
    '/projects/p1?phase=f1&phase=f2',
    '/projects/p1?phase=f1&document=r1',
    '/projects/p2?phase=f1',
    '/projects/p1?phase=f1&extra=x',
    '/projects/p1?phase=%E0%A4%A',
  ].join(' ')
  assert.deepEqual(extractProjectChatLinks(body, 'p1'), [])
  assert.equal(splitProjectChatBody(body, 'p1').map(segment => segment.text).join(''), body)
  assert.equal(parseProjectChatHref('/projects/p1?phase=f1&activity=a1#general-requests', 'p1'), null)
  assert.equal(parseProjectChatHref('/projects/p1?phase=f1&activity=a1&activity=a2#activity-a1', 'p1'), null)
  assert.equal(parseProjectChatHref('/projects/p1?phase=__general__&activity=a1&document=r1#general-requests', 'p1'), null)
  assert.equal(parseProjectChatHref('https://evil.example/projects/p1?phase=f1', 'p1'), null)
})

test('mascarea verifică proiectul și lanțul fază → activitate → cerere', () => {
  const hiddenRequestId = 'request-hidden-uuid'
  const rows = [
    {
      id: 'message-1',
      body: [
        '/projects/p1?phase=f1',
        '/projects/p1?phase=f1&activity=a1#activity-a1',
        `/projects/p1?phase=f1&activity=a1&document=${hiddenRequestId}#activity-a1`,
        `/projects/p1?phase=__general__&document=request-general#general-requests`,
      ].join(' '),
      deleted_at: null,
      images: [{ path: 'projects/p1/chat/i.png' }],
    },
    { id: 'deleted', body: '/projects/p1?phase=draft-phase', deleted_at: '2026-09-01T00:00:00Z', images: [{ path: 'keep' }] },
  ]
  const masked = maskProjectChatBodiesFromVisibilityMaps(rows, 'p1', {
    phases: [
      { id: 'f1', project_id: 'p1', visibility: 'published' },
      { id: 'draft-phase', project_id: 'p1', visibility: 'draft' },
      { id: 'other-phase', project_id: 'p2', visibility: 'published' },
    ],
    activities: [
      { id: 'a1', phase_id: 'f1', visibility: 'published' },
      { id: 'a-draft', phase_id: 'f1', visibility: 'draft' },
      { id: 'a-parent-draft', phase_id: 'draft-phase', visibility: 'published' },
    ],
    requests: [
      { id: hiddenRequestId, project_id: 'p1', activity_id: 'a1', visibility: 'draft', deleted_at: null },
      { id: 'request-general', project_id: 'p1', activity_id: null, visibility: 'published', deleted_at: null },
      { id: 'request-deleted', project_id: 'p1', activity_id: null, visibility: 'published', deleted_at: '2026-09-01' },
    ],
  })

  assert.equal(masked[0].body.includes(hiddenRequestId), false)
  assert.equal(masked[0].body.includes('Element indisponibil'), true)
  assert.equal(masked[0].body.includes('/projects/p1?phase=f1'), true)
  assert.equal(masked[0].body_masked, true)
  assert.deepEqual(masked[0].images, rows[0].images)
  assert.deepEqual(masked[1], rows[1])
})

test('cererile generale nu moștenesc o activitate și drafturile părinte sunt ascunse', () => {
  const rows = [{ body: '/projects/p1?phase=__general__&document=general#general-requests /projects/p1?phase=f1&activity=a-parent&document=child#activity-a-parent', deleted_at: null }]
  const resultRows = maskProjectChatBodiesFromVisibilityMaps(rows, 'p1', {
    phases: [{ id: 'f1', project_id: 'p1', visibility: 'draft' }],
    activities: [{ id: 'a-parent', phase_id: 'f1', visibility: 'published' }],
    requests: [
      { id: 'general', project_id: 'p1', activity_id: null, visibility: 'published', deleted_at: null },
      { id: 'child', project_id: 'p1', activity_id: 'a-parent', visibility: 'published', deleted_at: null },
    ],
  })
  assert.equal(resultRows[0].body, '/projects/p1?phase=__general__&document=general#general-requests Element indisponibil')
  assert.equal(resultRows[0].body_masked, true)
})

test('un element mutat după scrierea linkului rămâne vizibil', () => {
  // Href-urile îngheață poziția de la momentul scrierii. Cererea `moved` a fost
  // legată de `a1` din `f1`; între timp activitatea i-a fost ștearsă și cererea
  // a ajuns la „Cereri generale" (`safe_parent_deletion` pune `activity_id =
  // null`). Cererea `rehomed` a fost mutată la altă activitate, iar activitatea
  // `a-moved` a fost mutată în altă fază. Toate trei există și sunt publicate,
  // deci niciuna nu trebuie mascată.
  const body = [
    '/projects/p1?phase=f1&activity=a1&document=moved#activity-a1',
    '/projects/p1?phase=f1&activity=a1&document=rehomed#activity-a1',
    '/projects/p1?phase=f1&activity=a-moved#activity-a-moved',
  ].join(' ')
  const rows = [{ body, deleted_at: null }]

  const visible = maskProjectChatBodiesFromVisibilityMaps(rows, 'p1', {
    phases: [
      { id: 'f1', project_id: 'p1', visibility: 'published' },
      { id: 'f2', project_id: 'p1', visibility: 'published' },
    ],
    activities: [
      { id: 'a2', phase_id: 'f1', visibility: 'published' },
      { id: 'a-moved', phase_id: 'f2', visibility: 'published' },
    ],
    requests: [
      { id: 'moved', project_id: 'p1', activity_id: null, visibility: 'published', deleted_at: null },
      { id: 'rehomed', project_id: 'p1', activity_id: 'a2', visibility: 'published', deleted_at: null },
    ],
  })

  assert.equal(visible[0].body, body)
  assert.equal(visible[0].body_masked, undefined)
})

test('mutarea nu scapă de sub vizibilitatea părintelui de acum', () => {
  // Aceleași mutări, dar noul părinte e draft: mascarea trebuie să se aplice,
  // altfel „rezolvă după starea de acum" ar deveni o portiță.
  const rows = [{
    body: '/projects/p1?phase=f1&activity=a1&document=rehomed#activity-a1 /projects/p1?phase=f1&activity=a-moved#activity-a-moved',
    deleted_at: null,
  }]

  const masked = maskProjectChatBodiesFromVisibilityMaps(rows, 'p1', {
    phases: [
      { id: 'f1', project_id: 'p1', visibility: 'published' },
      { id: 'f-draft', project_id: 'p1', visibility: 'draft' },
    ],
    activities: [
      { id: 'a2', phase_id: 'f1', visibility: 'draft' },
      { id: 'a-moved', phase_id: 'f-draft', visibility: 'published' },
    ],
    requests: [
      { id: 'rehomed', project_id: 'p1', activity_id: 'a2', visibility: 'published', deleted_at: null },
    ],
  })

  assert.equal(masked[0].body, 'Element indisponibil Element indisponibil')
  assert.equal(masked[0].body_masked, true)
})
