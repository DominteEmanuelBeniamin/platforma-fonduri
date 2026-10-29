/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react-hooks/exhaustive-deps */
'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowLeft,
  AlertCircle,
  Pencil,
  Check,
  Loader2,
  Layers,
  Building2,
  MessageSquare,
  FolderOpen,
  Search,
  Plus,
  Megaphone,
  CalendarDays,
  Bell,
  BellOff,
  Copy,
  Trash2,
  Archive,
  RotateCcw,
  CheckCircle2,
  Table2,
  ListTodo,
  ChevronsDownUp,
  ChevronsUpDown,
  Upload,
  PanelLeftOpen,
} from 'lucide-react'

import {
  REMINDERS_ERROR_MESSAGE,
  automaticRemindersEnabled,
  remindersActionLabel,
  remindersDoneMessage,
  remindersOffConfirm,
  saveAutomaticReminders,
} from '@/lib/automatic-reminders'
import ProjectChatDrawer from '@/components/ProjectChatDrawer'
import ProjectTeam from '@/components/ProjectTeam'
import { bandFor, type SignalTone } from '@/lib/signage'
import { LocationStrip } from '@/components/ui/LocationStrip'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { Counter } from '@/components/ui/Counter'
import ProjectPhasesSidebar from '@/components/ProjectPhasesSidebar'
import RowActionsMenu from '@/components/RowActionsMenu'
import InlineInput from '@/components/InlineInput'
import {
  activityDeletionConfirm,
  activityDeletionImpact,
  phaseDeletionConfirm,
  phaseDeletionImpact,
} from '@/lib/deletion-impact'
import type { ProjectActivity, ProjectPhase } from '@/components/ProjectPhasesSidebar'
import DocumentRequests from '@/components/DocumentRequests'
import DocumentModal from '@/components/DocumentModal'
import ProjectDocumentsView from '@/components/ProjectDocumentsView'
import TableGroup, { ColumnHeader, GroupSummary, activityColumnsTemplate, type SummarySegment } from '@/components/project-table/TableGroup'
import ActivityRow from '@/components/project-table/ActivityRow'
import { AssigneePicker } from '@/components/project-table/AssigneePicker'
import { formatShortDate } from '@/components/project-table/cells'
import { activityStatus, deadlineRange, requestTone, startOfToday } from '@/lib/activity-status'
import ActionNeededPanel from '@/components/ActionNeededPanel'
import PublishStatusControl from '@/components/PublishStatusControl'
import UnifiedSearchDialog from '@/components/UnifiedSearchDialog'
import CalendarSurface from '@/components/calendar/CalendarSurface'
import { buildSearchIndex, type SearchResult } from '@/lib/projectSearch'
import { buildProjectChatHref } from '@/lib/project-chat-links'
import { isClientVisibleActivity, isClientVisibleDocument, isClientVisiblePhase } from '@/lib/client-visibility'
import { publishBlockers } from '@/lib/publish-rules'
import { serverMessage } from '@/lib/api-error'
import { activityDuplicateConfirm, activityDuplicatedMessage, phaseDuplicateConfirm, phaseDuplicatedMessage } from '@/lib/duplication-summary'
import {
  GENERAL_PHASE_ID,
  clearCalendarParams,
  isActivityDone,
  isRequestDone,
  isUrgentDeadline,
  requestOwnerId,
} from '@/lib/calendar'
import { useAuth } from '@/app/providers/AuthProvider'
import { useToast } from '@/app/providers/ToastProvider'
import { usePatchField } from '@/hooks/usePatchField'
import { useLeaveField } from '@/hooks/useLeaveField'
import { NO_PROJECT_PERMISSIONS, type ProjectPermissions } from '@/lib/project-permissions'
import { Spinner } from '@/components/ui/Spinner'
import { profileDisplayName } from '@/lib/profile-display'
import { Signal } from '@/components/ui/Signal'
import HiddenFinalRow from '@/components/HiddenFinalRow'
import {
  activityCompletionBlocker,
  activityCompletionConfirm,
  activityProgress,
  countHiddenRoots,
  hasFinalItems,
  hiddenFinalItems,
  type HiddenItems,
  isActivityFinal,
  isPhaseFinal,
  isRequestFinal,
  phaseCompletionBlocker,
  phaseCompletionConfirm,
  phaseProgress,
  progressLabel,
} from '@/lib/completion'
import {
  PROJECT_CLOSED_REMINDERS_HINT,
  countOverdueOpenItems,
  isProjectActive,
  projectCloseConfirm,
  PROJECT_CLOSE_REVIEW_FIRST_MESSAGE,
  projectClosedLabel,
  projectReopenConfirm,
} from '@/lib/project-lifecycle'

// Secțiunea distinctă „Cereri generale" (documente fără fază/activitate).
// Aceeași valoare ajunge în `?phase=` din deep-linkurile calendarului.
const GENERAL_ID = GENERAL_PHASE_ID
// Grupul documentelor trimise clientului, separat de cererile generale (S-20).
// Nu e o fază: doar ținta focusului din panou.
const SENT_ID = '__trimise__'

// Tabul curent. Se reflectă în `?view=`, ca vederea să poată fi trimisă mai
// departe ca link; „phases" e implicitul, deci nu ajunge în URL.
type ProjectView = 'phases' | 'documents' | 'calendar'

/**
 * Comutatorul „Arată și ce e finalizat" (#109): o preferință a browserului,
 * aceeași pentru toate proiectele (D11). Nu se salvează pe server.
 */
const SHOW_FINAL_KEY = 'bonie:arata-finalizate'
/** Panoul fazelor strâns pe calculator — tot o preferință a browserului. */
const SIDEBAR_COLLAPSED_KEY = 'bonie:panou-faze-strans'
const NOTHING_HIDDEN: HiddenItems = { phases: new Set(), activities: new Set(), requests: new Set() }

// ─── Page ─────────────────────────────────────────────────────────────────────

function ProjectDetailsContent() {
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()
  const targetPhaseId = searchParams.get('phase')
  const targetActivityId = searchParams.get('activity')
  const targetDocumentId = searchParams.get('document')
  const targetView = searchParams.get('view')
  // Doar un deep-link duce direct în „Fazele proiectului"; `?view=` singur nu.
  // Altfel, o dată deschis tabul Documente sau Calendar, reîncărcarea ar fi
  // scos pentru totdeauna ecranul „Ce ai de făcut" — cel implicit al clientului.
  const hasDeepLink = !!(targetPhaseId || targetActivityId || targetDocumentId)
  const targetFolderId = searchParams.get('folder')
  const projectId = useMemo(() => {
    const id = (params as any)?.id
    return typeof id === 'string' && id.trim().length > 0 ? id : null
  }, [params])

  const { loading: authLoading, token, apiFetch, profile, profileError } = useAuth()
  const { showToast, confirm } = useToast()
  const patchField = usePatchField()

  const [project, setProject] = useState<any>(null)
  const [permissions, setPermissions] = useState<ProjectPermissions>(NO_PROJECT_PERMISSIONS)
  const [phases, setPhases] = useState<ProjectPhase[]>([])
  const [allDocRequests, setAllDocRequests] = useState<any[]>([])
  const [selectedDocumentRequestId, setSelectedDocumentRequestId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [documentsError, setDocumentsError] = useState<string | null>(null)
  const [projectMembers, setProjectMembers] = useState<{ id: string; full_name: string | null; email: string; is_active?: boolean | null }[]>([])
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set())
  const [expandedActivityIds, setExpandedActivityIds] = useState<Set<string>>(new Set())
  const [activePhaseId, setActivePhaseId] = useState<string | null>(null)

  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [saving, setSaving] = useState(false)

  const [chatOpen, setChatOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [notifyingClient, setNotifyingClient] = useState(false)
  const [togglingReminders, setTogglingReminders] = useState(false)

  const [activeView, setActiveView] = useState<ProjectView>(
    targetView === 'documents' || targetView === 'calendar' ? targetView : 'phases'
  )
  // „Tabel principal” sau „Ce ai de făcut”. Tabelul e vederea de pornire a
  // tuturor; un deep-link duce tot în el, la rândul cerut.
  const [landingView, setLandingView] = useState<'table' | 'action-needed'>('table')
  // Grupurile tabelului (fazele și „Cereri generale”) sunt deschise implicit,
  // ca în monday; aici stau doar cele strânse de om. `expandedPhases` rămâne al
  // panoului din stânga, care își deschide fazele separat.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set())
  // Faza sau activitatea redenumită pe loc, în tabel. Se închide singură la
  // orice schimbare de context: altă vedere, altă fază, grupuri strânse (S-11).
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const openGroups = useCallback((...ids: (string | null | undefined)[]) => {
    setCollapsedGroups(prev => {
      if (!ids.some(id => id && prev.has(id))) return prev
      const next = new Set(prev)
      for (const id of ids) if (id) next.delete(id)
      return next
    })
  }, [])
  // Faza aleasă — din panoul fazelor, din căutare, din „Ce ai de făcut” sau
  // dintr-un link: tabelul arată doar grupul ei, nu tot proiectul. `null`
  // înseamnă toate fazele. Separat de `activePhaseId`, pe care `fetchAll` îl
  // resetează la fiecare reîncărcare (de pildă după o activitate nouă).
  const [focusedPhaseId, setFocusedPhaseId] = useState<string | null>(null)
  const focusPhase = useCallback((id: string) => {
    setFocusedPhaseId(id)
    openGroups(id)
  }, [openGroups])
  const toggleGroup = (id: string) => {
    setRenamingId(null)
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  useEffect(() => {
    try { setSidebarCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1') } catch { /* stocare indisponibilă */ }
  }, [])
  const changeSidebarCollapsed = (next: boolean) => {
    setSidebarCollapsed(next)
    try { window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0') } catch { /* rămâne doar pentru sesiunea asta */ }
  }
  // Pe calculator panoul e coloană și doar se redeschide dacă era strâns; pe
  // telefon e sertar.
  const openPhasesPanel = () => {
    if (window.matchMedia('(min-width: 768px)').matches) changeSidebarCollapsed(false)
    else setMobileSidebarOpen(true)
  }
  const [searchOpen, setSearchOpen] = useState(false)
  const [autoOpenRequestId, setAutoOpenRequestId] = useState<string | null>(null)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  // Două momente distincte din viața aceluiași deep-link: `appliedDeepLink` —
  // tabul și faza au fost mutate; `handledDeepLink` — s-a derulat până la
  // element. Al doilea îl așteaptă pe primul și pe randare, deci nu pot fi unul.
  const appliedDeepLink = useRef<string | null>(null)
  const handledDeepLink = useRef<string | null>(null)
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Ancoră de evidențiat după ce se închide fișa cererii deschise din chat. */
  const pendingRevealAnchor = useRef<string | null>(null)
  const highlightAnimation = useRef<Animation | null>(null)

  // `block`: unde ajunge ținta. Implicit la mijloc, ca pentru deep-linkuri,
  // căutare și „Ce ai de făcut”. Panoul de faze cere `start`: o fază sau o
  // activitate deschisă poate fi mai înaltă decât ecranul, iar începutul ei
  // trebuie să rămână la vedere, sub bare.
  const revealTarget = useCallback((anchor: string, delay = 120, block: ScrollLogicalPosition = 'center') => {
    if (revealTimer.current) clearTimeout(revealTimer.current)
    const reveal = (attempt = 0) => {
      const el = document.getElementById(anchor)
      if (!el) {
        if (attempt < 4) revealTimer.current = setTimeout(() => reveal(attempt + 1), 80)
        return
      }
      // Ținta deja la vedere, sub barele lipite (le ține `scroll-margin-top`),
      // nu mută pagina: doar se evidențiază. Un salt inutil mută și ce era sub
      // cursor, iar cine apucase să tragă ceva l-ar scăpa.
      const box = el.getBoundingClientRect()
      const reserved = parseFloat(getComputedStyle(el).scrollMarginTop) || 0
      const inView = box.top >= reserved && box.bottom <= window.innerHeight
      if (!inView) el.scrollIntoView({ behavior: 'smooth', block })
      highlightAnimation.current?.cancel()
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--p-accent').trim() || '#4f46e5'
      const ring = anchor.startsWith('request-')
        ? `inset 0 0 0 2px ${accent}`
        : `0 0 0 3px ${accent}, 0 0 0 7px color-mix(in srgb, ${accent} 18%, transparent)`
      highlightAnimation.current = el.animate([
        { boxShadow: '0 0 0 0 transparent' },
        { boxShadow: ring, offset: 0.18 },
        { boxShadow: ring, offset: 0.68 },
        { boxShadow: '0 0 0 0 transparent' },
      ], { duration: 1800, easing: 'ease-out' })
    }
    revealTimer.current = setTimeout(reveal, delay)
  }, [])

  useEffect(() => () => {
    if (revealTimer.current) clearTimeout(revealTimer.current)
    highlightAnimation.current?.cancel()
  }, [])

  const [showAddActivity, setShowAddActivity] = useState<Record<string, boolean>>({})
  const [addingActivity, setAddingActivity] = useState<Record<string, boolean>>({})

  // Aceeași regulă ca `buildDriveDocuments`: dacă există rânduri în
  // `attachments`, doar ele contează — altfel badge-ul ar număra un atașament
  // legacy pe care Drive-ul nu-l arată, și cifrele n-ar mai corespunde.
  const documentEntriesCount = useMemo(() => {
    return allDocRequests.filter(req => {
      const hasAttachment = req.attachments?.length
        ? req.attachments.some((attachment: any) => !attachment.missing_at)
        : Boolean(req.attachment_path && !req.attachment_missing_at)
      const hasFile = (req.files ?? []).some((file: any) => !file.deleted_at)
      return hasAttachment || hasFile
    }).length
  }, [allDocRequests])

  // Indicatorul de pe tabul „Calendar": termene depășite sau din următoarele 7
  // zile. Se calculează din datele deja încărcate — filtrate de vizibilitate pe
  // server — ca badge-ul să fie corect fără o a treia cerere.
  //
  // Consultantul se numără doar pe el, fiindcă exact așa se deschide și
  // calendarul: altfel ar fi văzut un „7" roșu care duce într-o vedere cu un
  // singur element, sau chiar goală.
  const calendarUrgentCount = useMemo(() => {
    // Un proiect încheiat nu mai are termene care să ceară atenție (#109, D5):
    // reminderele lui s-au oprit, deci nici indicatorul nu mai numără.
    if (project && !isProjectActive(project)) return 0
    const mineOnly = profile?.role === 'consultant' ? profile.id : null
    const generalOwnerId = projectMembers.some(m => m.id === project?.general_consultant_id)
      ? project?.general_consultant_id ?? null
      : null
    const counts = (deadline: string | null, done: boolean, ownerId: string | null) =>
      isUrgentDeadline(deadline, done) && (!mineOnly || ownerId === mineOnly)

    let count = 0
    for (const phase of phases) {
      for (const activity of phase.activities ?? []) {
        if (counts(activity.deadline_at ?? null, isActivityDone(activity), activity.assigned_to ?? null)) count++
      }
    }
    for (const req of allDocRequests) {
      if (req.is_outgoing || req.deleted_at) continue
      const ownerId = requestOwnerId({
        assigned_to: req.assigned_to,
        activity_id: req.activity_id,
        activity: req.activity,
        generalOwnerId,
      })
      if (counts(req.deadline_at ?? null, isRequestDone(req), ownerId)) count++
    }
    return count
  }, [phases, allDocRequests, profile?.role, profile?.id, project?.general_consultant_id, project?.lifecycle_status, projectMembers])
  // Derivat, nu snapshot: după `refreshDocs` modalul trebuie să vadă datele noi,
  // nu obiectul capturat la click. Dacă cererea dispare, modalul se închide.
  const selectedDocumentRequest = useMemo(
    () => allDocRequests.find(req => req.id === selectedDocumentRequestId) ?? null,
    [allDocRequests, selectedDocumentRequestId],
  )

  // Ceva publicat, dar neanunțat încă printr-un digest — activează butonul „Anunță clientul"
  const hasUnnotifiedUpdates = useMemo(() => {
    for (const phase of phases) {
      if (isClientVisiblePhase(phase) && !phase.client_notified_at) return true
      for (const activity of phase.activities ?? []) {
        if (isClientVisibleActivity({ ...activity, phase }) && !activity.client_notified_at) return true
      }
    }
    return allDocRequests.some((req: any) =>
      req.status !== 'closed' &&
      isClientVisibleDocument(req) && (!req.client_notified_at || req.has_unnotified_review)
    )
  }, [phases, allDocRequests])

  const handleOpenChat = () => {
    setChatOpen(true)
  }

  // Tabul curent trăiește și în URL, ca vederea să poată fi trimisă ca link.
  //
  // Schimbarea tabului șterge deep-linkul rămas în URL: el descrie un element
  // spre care s-a derulat cândva, nu vederea de acum. Lăsat pe loc, ar fi făcut
  // două rele — la reîncărcare ar fi tras înapoi în „Faze & Activități", iar
  // reselectarea aceluiași eveniment din calendar n-ar mai fi schimbat niciun
  // parametru, deci n-ar fi părut să facă nimic.
  const selectView = (view: ProjectView) => {
    setActiveView(view)
    // Altă vedere, alt context: redenumirea începută nu rămâne agățată (S-11).
    setRenamingId(null)
    if (!projectId) return
    const params = new URLSearchParams(searchParams.toString())
    if (view === 'phases') {
      params.delete('view')
      params.delete('folder')
    } else {
      params.set('view', view)
      if (view === 'calendar') params.delete('folder')
    }
    if (view !== 'calendar') clearCalendarParams(params)
    for (const key of ['phase', 'activity', 'document']) params.delete(key)
    const query = params.toString()
    router.replace(query ? `/projects/${projectId}?${query}` : `/projects/${projectId}`, { scroll: false })
  }

  const isAdmin = profile?.role === 'admin'
  const isConsultant = profile?.role === 'consultant'
  const isClient = profile?.role === 'client'
  const canEdit = isAdmin || isConsultant

  // ─── Fetch ────────────────────────────────────────────────────────────────

  const fetchAll = async () => {
    if (!projectId) return
    setLoading(true)
    setDocumentsError(null)
    try {
      const [projRes, phasesRes, docsRes] = await Promise.all([
        apiFetch(`/api/projects/${projectId}`),
        apiFetch(`/api/projects/${projectId}/phases`),
        apiFetch(`/api/projects/${projectId}/document-requests`),
      ])

      if (!projRes.ok) { router.replace('/'); return }
      const projJson = await projRes.json()
      setProject(projJson.project)
      setPermissions(projJson.permissions ?? NO_PROJECT_PERMISSIONS)

      if (phasesRes.ok) {
        const ph: ProjectPhase[] = (await phasesRes.json()).phases || []
        const isFirstLoad = phases.length === 0
        setPhases(ph)

        // Nu resetăm fazele deja pliate/depliate la fiecare refresh — doar
        // curățăm id-urile fazelor șterse între timp din setul de expandate.
        setExpandedPhases(prev => {
          const validIds = new Set(ph.map(p => p.id))
          validIds.add(GENERAL_ID)
          const next = new Set([...prev].filter(id => validIds.has(id)))
          return next.size === prev.size ? prev : next
        })

        if (!hasDeepLink) {
          setActivePhaseId(null)
          if (isFirstLoad) setExpandedPhases(new Set())
        } else if (targetPhaseId === GENERAL_ID) {
          setActivePhaseId(GENERAL_ID)
          if (isFirstLoad) {
            setExpandedPhases(prev => new Set(prev).add(GENERAL_ID))
          }
        } else if (targetPhaseId) {
          const active = ph.find(p => p.id === targetPhaseId)
          if (active) {
            setActivePhaseId(active.id)
            // Doar la primul load semănăm faza activă ca implicit deplasată —
            // refresh-urile ulterioare nu trebuie să repliaze fazele utilizatorului.
            if (isFirstLoad) {
              setExpandedPhases(prev => new Set(prev).add(active.id))
            }
          }
        }
      }

      if (docsRes.ok) {
        setAllDocRequests((await docsRes.json()).requests || [])
      } else {
        setDocumentsError('Reîncearcă încărcarea documentelor.')
      }
    } catch (error) {
      console.error('Project data load error:', error)
      setDocumentsError('Reîncearcă încărcarea documentelor.')
    } finally {
      setLoading(false)
    }
  }

  // Duplicare (#15) din panoul central — aceleași endpointuri ca în bara din
  // stânga. Reîmprospătăm doar fazele și cererile, ca pagina să nu treacă prin
  // spinnerul care remontează tot (vezi garda de `loading` de mai jos).
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null)
  const [savingRename, setSavingRename] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const renameItem = async (url: string, id: string, name: string) => {
    setSavingRename(id)
    try {
      const res = await apiFetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) { showToast('Nu am putut salva numele. Reîncearcă.', 'error'); return }
      setRenamingId(null)
      await refreshPhases()
    } catch {
      showToast('Nu am putut salva numele. Reîncearcă.', 'error')
    } finally { setSavingRename(null) }
  }

  const deleteItem = async (url: string, id: string, errorMessage: string) => {
    setDeletingId(id)
    try {
      const res = await apiFetch(url, { method: 'DELETE' })
      if (!res.ok) { showToast(errorMessage, 'error'); return }
      await Promise.all([refreshPhases(), refreshDocs()])
    } catch {
      showToast(errorMessage, 'error')
    } finally { setDeletingId(null) }
  }

  const askToDeletePhase = async (phase: ProjectPhase) => {
    const confirmed = await confirm(phaseDeletionConfirm(phase, phaseDeletionImpact(allDocRequests, phase)))
    if (confirmed) {
      await deleteItem(`/api/projects/${projectId}/phases/${phase.id}`, phase.id, 'Nu am putut șterge faza. Reîncearcă.')
    }
  }

  const askToDeleteActivity = async (phase: ProjectPhase, activity: ProjectActivity) => {
    const confirmed = await confirm(
      activityDeletionConfirm(activity, activityDeletionImpact(allDocRequests, phase, activity)),
    )
    if (confirmed) {
      await deleteItem(
        `/api/projects/${projectId}/phases/${phase.id}/activities/${activity.id}`,
        activity.id,
        'Nu am putut șterge activitatea. Reîncearcă.',
      )
    }
  }

  const handleDuplicatePhase = async (phaseId: string, phaseName: string) => {
    if (duplicatingId) return
    if (!(await confirm(phaseDuplicateConfirm(phaseName)))) return
    setDuplicatingId(phaseId)
    try {
      const res = await apiFetch(`/api/projects/${projectId}/phases/${phaseId}/duplicate`, { method: 'POST' })
      if (!res.ok) {
        showToast(await serverMessage(res, 'Nu am putut duplica faza. Reîncearcă.'), 'error')
        return
      }
      const { phase: copy, activities_created, document_requests_created, warnings } = await res.json()
      await refreshContent()
      if (copy?.id) {
        setExpandedPhases(prev => new Set(prev).add(copy.id))
        // Cu o singură fază în tabel, copia n-ar fi pe ecran: tabelul trece la
        // ea, ca redenumirea în care intră să se vadă.
        if (focusedPhaseId) focusPhase(copy.id)
        setRenamingId(copy.id)
      }
      const omittedAssignments = Array.isArray(warnings) ? warnings.length : 0
      showToast(phaseDuplicatedMessage(phaseName, {
        activities: activities_created ?? 0,
        documentRequests: document_requests_created ?? 0,
      }, omittedAssignments), omittedAssignments > 0 ? 'warning' : 'success')
    } catch {
      showToast('Nu am putut duplica faza. Reîncearcă.', 'error')
    } finally { setDuplicatingId(null) }
  }

  const handleDuplicateActivity = async (phaseId: string, activityId: string, activityName: string) => {
    if (duplicatingId) return
    if (!(await confirm(activityDuplicateConfirm(activityName)))) return
    setDuplicatingId(activityId)
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/phases/${phaseId}/activities/${activityId}/duplicate`,
        { method: 'POST' },
      )
      if (!res.ok) {
        showToast(await serverMessage(res, 'Nu am putut duplica activitatea. Reîncearcă.'), 'error')
        return
      }
      const { activity: copy, document_requests_created, warnings } = await res.json()
      await refreshContent()
      if (copy?.id) setRenamingId(copy.id)
      const omittedAssignments = Array.isArray(warnings) ? warnings.length : 0
      showToast(activityDuplicatedMessage(activityName, document_requests_created ?? 0, omittedAssignments), omittedAssignments > 0 ? 'warning' : 'success')
    } catch {
      showToast('Nu am putut duplica activitatea. Reîncearcă.', 'error')
    } finally { setDuplicatingId(null) }
  }

  const refreshDocs = async () => {
    if (!projectId) return
    try {
      const res = await apiFetch(`/api/projects/${projectId}/document-requests`)
      if (res.ok) {
        setAllDocRequests((await res.json()).requests || [])
        setDocumentsError(null)
      } else {
        setDocumentsError('Reîncearcă încărcarea documentelor.')
      }
    } catch (e) {
      console.error(e)
      setDocumentsError('Reîncearcă încărcarea documentelor.')
    }
  }

  // Refresh silențios după reordonare — fără spinner și fără resetarea fazei active
  const refreshPhases = async () => {
    if (!projectId) return
    try {
      const res = await apiFetch(`/api/projects/${projectId}/phases`)
      if (res.ok) setPhases((await res.json()).phases || [])
    } catch (e) { console.error(e) }
  }

  const fetchProjectMembers = async () => {
    if (!projectId) return
    try {
      const r = await apiFetch(`/api/projects/${projectId}/members`)
      const d = await r.json()
      setProjectMembers(
        (d.members ?? []).map((m: any) => ({
          id: m.profiles?.id ?? m.consultant_id,
          full_name: m.profiles?.full_name ?? null,
          email: m.profiles?.email ?? '',
          is_active: m.profiles?.is_active ?? null,
        }))
      )
    } catch (e) { console.error(e) }
  }

  useEffect(() => {
    if (authLoading) return
    if (!token) { router.replace('/login'); return }
    fetchAll()
  }, [authLoading, token, projectId])

  useEffect(() => {
    setActiveView(targetView === 'documents' ? 'documents' : 'phases')
  }, [targetView])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const isTyping = target && ['INPUT', 'TEXTAREA'].includes(target.tagName)
      if (e.key === '/' && !isTyping && !searchOpen) {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [searchOpen])

  useEffect(() => {
    if (authLoading || !token || !projectId) return
    fetchProjectMembers()
  }, [authLoading, token, projectId])

  // ─── Actions ──────────────────────────────────────────────────────────────

  // Titlul se încheie ca orice câmp pe loc (D1): plecarea salvează un nume
  // schimbat și negol, altfel închide. Garda ține un singur deznodământ, fiindcă
  // un clic în afară aduce și `pointerdown`, și `focusout`.
  const titleEditorRef = useRef<HTMLDivElement>(null)
  const titleSettling = useRef(false)
  const handleSaveTitle = async () => {
    if (titleSettling.current) return
    if (!editTitle.trim() || editTitle.trim() === project?.title) { setIsEditingTitle(false); return }
    titleSettling.current = true
    setSaving(true)
    try {
      const res = await apiFetch(`/api/projects/${projectId}`, {
        method: 'PATCH', body: JSON.stringify({ title: editTitle.trim() })
      })
      const data = await res.json().catch(() => null)
      if (res.ok) { setProject(data.project); setIsEditingTitle(false) }
      else showToast('Nu am putut salva proiectul. Reîncearcă.', 'error')
    } finally {
      setSaving(false)
      titleSettling.current = false
    }
  }
  useLeaveField(titleEditorRef, isEditingTitle, () => { void handleSaveTitle() })

  // Reîmprospătăm tăcut, nu prin `fetchAll`: aceasta aprinde spinnerul de
  // pagină și demontează tot arborele, adică și editorul deschis pe loc, și
  // cererile pliate, și dialogul de adăugare pe jumătate completat. Cererile
  // se reîncarcă odată cu fazele fiindcă poartă în join responsabilul
  // activității, de care atârnă chipurile lor de publicare.
  const refreshContent = async () => { await Promise.all([refreshPhases(), refreshDocs()]) }

  const patchActivityField = (
    phaseId: string,
    activityId: string,
    body: Record<string, unknown>,
    fallback: string,
    success?: string,
  ) => patchField(
    `/api/projects/${projectId}/phases/${phaseId}/activities/${activityId}`,
    body,
    { fallback, success, refresh: refreshContent },
  )

  const handleAssignActivity = (phaseId: string, activityId: string, assignedTo: string | null) =>
    patchActivityField(phaseId, activityId, { assigned_to: assignedTo }, 'Nu am putut atribui consultantul. Reîncearcă.')

  const saveActivityDeadline = async (phaseId: string, activityId: string, deadline: string) => {
    await patchActivityField(
      phaseId,
      activityId,
      { deadline_at: deadline },
      'Nu am putut salva termenul. Reîncearcă.',
      'Termenul limită a fost salvat.',
    )
  }

  const handleAddActivity = async (phaseId: string, name: string) => {
    if (!name.trim()) return
    setAddingActivity(prev => ({ ...prev, [phaseId]: true }))
    try {
      const res = await apiFetch(`/api/projects/${projectId}/phases/${phaseId}/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })
      if (res.ok) {
        setShowAddActivity(prev => ({ ...prev, [phaseId]: false }))
        // Tăcut, nu prin `fetchAll`: spinnerul de pagină ar remonta tabelul.
        await refreshContent()
        showToast('Activitatea a fost adăugată.', 'success')
      } else {
        await res.json().catch(() => null)
        showToast('Nu am putut adăuga activitatea. Reîncearcă.', 'error')
      }
    } catch {
      showToast('Nu am putut adăuga activitatea. Reîncearcă.', 'error')
    } finally {
      setAddingActivity(prev => ({ ...prev, [phaseId]: false }))
    }
  }

  const publishProjectItem = async (
    url: string,
    copy: { title?: string; description?: string } = {},
  ) => {
    if (!await confirm({
      title: copy.title || 'Publică elementul?',
      description: copy.description || 'Elementul va deveni vizibil clientului.',
      confirmText: 'Publică',
    })) return
    // `patchField` a arătat deja motivul și aruncă mai departe; aici nu mai e
    // nimic de făcut cu eroarea.
    try {
      await patchField(url, { visibility: 'published' }, {
        fallback: 'Nu am putut publica elementul. Reîncearcă.',
        success: 'Elementul a fost publicat.',
        refresh: refreshContent,
      })
    } catch { /* mesajul e pe ecran */ }
  }


  const handleNotifyClient = async () => {
    if (!await confirm({
      title: 'Anunță clientul despre actualizări?',
      description: 'Se trimite un singur email către client cu noutățile publicate și documentele verificate de la ultima notificare.',
      confirmText: 'Trimite email',
    })) return
    setNotifyingClient(true)
    try {
      const res = await apiFetch(`/api/projects/${projectId}/notify-client`, { method: 'POST' })
      const data = await res.json().catch(() => null)
      if (res.ok) {
        await Promise.all([refreshPhases(), refreshDocs()])
        showToast('Clientul a fost anunțat prin email.', 'success')
      } else {
        // Serverul revalidează conținutul la momentul apăsării; sincronizează UI-ul
        // și când snapshot-ul vechi a lăsat butonul aparent activ.
        await Promise.allSettled([refreshPhases(), refreshDocs()])
        showToast(data?.error || 'Nu am putut anunța clientul. Reîncearcă.', 'error')
      }
    } catch {
      showToast('Nu am putut anunța clientul. Reîncearcă.', 'error')
    } finally {
      setNotifyingClient(false)
    }
  }

  /**
   * Același comutator ca în meniul cardului din Home (#85), aici fiindcă
   * proiectul se administrează din pagina lui: adminul care tocmai a mutat
   * termene nu trebuie să se întoarcă la listă ca să oprească reminderele.
   *
   * Textele, confirmarea și cererea vin din `lib/automatic-reminders`, ca cele
   * două butoane să nu poată începe să spună lucruri diferite.
   */
  const handleToggleAutomaticReminders = async () => {
    if (!project) return
    const nextEnabled = !automaticRemindersEnabled(project)
    if (!nextEnabled && !(await confirm(remindersOffConfirm(project.title)))) return

    setTogglingReminders(true)
    try {
      const savedEnabled = await saveAutomaticReminders(apiFetch, project.id, nextEnabled)
      setProject((prev: any) => (prev ? { ...prev, automatic_reminders_enabled: savedEnabled } : prev))
      showToast(remindersDoneMessage(savedEnabled), 'success')
    } catch {
      showToast(REMINDERS_ERROR_MESSAGE, 'error')
    } finally {
      setTogglingReminders(false)
    }
  }

  // ─── Încheierea proiectului (#109) ─────────────────────────────────────────

  const [changingLifecycle, setChangingLifecycle] = useState(false)
  const projectClosed = !!project && !isProjectActive(project)
  // Un proiect încheiat se poate doar consulta, de oricine (decizia din 8
  // octombrie 2026): dispar controalele de modificare, iar adminului și
  // seniorului le rămâne doar „Redeschide proiectul". Serverul refuză oricum.
  const canChange = canEdit && !projectClosed
  const perms: ProjectPermissions = projectClosed
    ? { ...NO_PROJECT_PERMISSIONS, close_project: permissions.close_project }
    : permissions

  /** Proiectul și permisiunile, fără spinnerul de pagină al lui `fetchAll`. */
  const refreshProject = async () => {
    if (!projectId) return
    try {
      const res = await apiFetch(`/api/projects/${projectId}`)
      if (!res.ok) return
      const json = await res.json()
      setProject(json.project)
      setPermissions(json.permissions ?? NO_PROJECT_PERMISSIONS)
    } catch (e) { console.error(e) }
  }

  /**
   * Se încheie și se redeschide doar din pagina proiectului (D7). Redeschiderea
   * spune dinainte câte termene sunt deja depășite: cronul de a doua zi trimite
   * „Termen depășit" pentru ele.
   */
  const handleProjectLifecycle = async (action: 'close' | 'reopen') => {
    if (!project || changingLifecycle) return
    // Încheiat, proiectul nu mai primește verificări: ce așteaptă verificarea se
    // rezolvă întâi. Aceeași regulă ca pe server, spusă înainte de orice apel.
    if (action === 'close') {
      const inReview = allDocRequests.filter((r: any) => r.status === 'review' && !r.deleted_at).length
      if (inReview > 0) {
        showToast(PROJECT_CLOSE_REVIEW_FIRST_MESSAGE(inReview), 'warning')
        return
      }
    }
    const dialog = action === 'close'
      ? projectCloseConfirm(project.title)
      : projectReopenConfirm(project.title, countOverdueOpenItems(phases, allDocRequests), automaticRemindersEnabled(project))
    if (!(await confirm(dialog))) return

    const fallback = action === 'close'
      ? 'Nu am putut încheia proiectul. Reîncearcă.'
      : 'Nu am putut redeschide proiectul. Reîncearcă.'
    setChangingLifecycle(true)
    try {
      const res = await apiFetch(`/api/projects/${projectId}/${action}`, { method: 'POST' })
      if (!res.ok) {
        showToast(await serverMessage(res, fallback), 'error')
        // Un 409 înseamnă că starea s-a schimbat din alt tab: pagina o preia.
        await refreshProject()
        return
      }
      const { project: updated } = await res.json()
      setProject((prev: any) => (prev ? { ...prev, ...updated } : prev))
      showToast(action === 'close' ? 'Proiectul a fost încheiat.' : 'Proiectul a fost redeschis.', 'success')
    } catch {
      showToast(fallback, 'error')
    } finally {
      setChangingLifecycle(false)
    }
  }

  // ─── Finalizarea fazelor și activităților (#109) ────────────────────────────

  const [completingId, setCompletingId] = useState<string | null>(null)

  /**
   * Doar adminul și seniorul membru (D1) văd acțiunile. Finalizarea cere ca tot
   * ce e dedesubt să fie gata; altfel spune ce lipsește, fără apel. Apoi cere
   * confirmarea (D2). Readucerea în lucru nu strică nimic, deci nu întreabă.
   */
  const handleItemCompletion = async (
    action: 'complete' | 'reopen',
    phase: ProjectPhase,
    activity?: ProjectActivity,
  ) => {
    const itemId = activity?.id ?? phase.id
    if (completingId) return
    if (action === 'complete') {
      // Întâi ce mai e deschis dedesubt: aceeași regulă ca pe server, spusă
      // înainte de orice apel (decizia din 7 octombrie 2026).
      const blocker = activity
        ? activityCompletionBlocker(activity.id, allDocRequests)
        : phaseCompletionBlocker(phase.activities ?? [])
      if (blocker) {
        showToast(blocker, 'warning')
        return
      }
      const dialog = activity
        ? activityCompletionConfirm(activity, allDocRequests)
        : phaseCompletionConfirm(phase, allDocRequests)
      if (!(await confirm(dialog))) return
    }
    const base = activity
      ? `/api/projects/${projectId}/phases/${phase.id}/activities/${activity.id}`
      : `/api/projects/${projectId}/phases/${phase.id}`
    const noun = activity ? 'Activitatea' : 'Faza'
    const fallback = action === 'complete'
      ? `Nu am putut marca ${activity ? 'activitatea' : 'faza'} ca finalizată. Reîncearcă.`
      : `Nu am putut readuce ${activity ? 'activitatea' : 'faza'} în lucru. Reîncearcă.`
    setCompletingId(itemId)
    try {
      const res = await apiFetch(`${base}/${action}`, { method: 'POST' })
      if (!res.ok) {
        showToast(await serverMessage(res, fallback), 'error')
        await refreshPhases()
        return
      }
      await refreshPhases()
      showToast(action === 'complete' ? `${noun} a fost marcată ca finalizată.` : `${noun} a fost readusă în lucru.`, 'success')
    } catch {
      showToast(fallback, 'error')
    } finally {
      setCompletingId(null)
    }
  }

  const handleAssignGeneralConsultant = async (assignedTo: string | null) => {
    try {
      const res = await apiFetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ general_consultant_id: assignedTo }),
      })
      if (res.ok) {
        const data = await res.json().catch(() => null)
        if (data?.project) setProject(data.project)
      } else {
        await res.json().catch(() => null)
        showToast('Nu am putut atribui consultantul. Reîncearcă.', 'error')
      }
    } catch { showToast('Nu am putut atribui consultantul. Reîncearcă.', 'error') }
  }

  // Doar fazele din `expandedPhases` sunt afișate în lista principală —
  // selectarea unei faze (mai jos) înlocuiește tot setul, exclusiv. Chevron-ul
  // individual doar adaugă/scoate o faza din set, fără să atingă restul —
  // folosit ca să închizi o faza vizibilă (ex. în modul „Toate fazele”).
  const handleToggleExpand = (phaseId: string) => {
    if (expandedPhases.has(phaseId) && activePhaseId === phaseId) {
      setActivePhaseId(null)
      if (hasDeepLink) selectView('phases')
    }
    setExpandedPhases(prev => {
      const next = new Set(prev)
      if (next.has(phaseId)) next.delete(phaseId)
      else next.add(phaseId)
      return next
    })
  }

  // Selectarea unei faze din panou: tabelul arată doar faza ei, iar în panou se
  // depliază doar ea.
  const handleSelectPhase = (phaseId: string) => {
    // Panoul lateral arată și fazele finalizate (D10): alese de acolo, apar.
    reveal(phaseId)
    selectView('phases')
    setLandingView('table')
    setActivePhaseId(phaseId)
    setExpandedPhases(new Set([phaseId]))
    focusPhase(phaseId)
    setMobileSidebarOpen(false)
    revealTarget(`phase-${phaseId}`, 120, 'start')
  }

  // Clic pe o activitate în panoul de faze: tabelul arată faza ei, activitatea
  // se desface, pagina sare la ea și o evidențiază.
  const handleSelectActivity = (phaseId: string, activityId: string) => {
    reveal(phaseId, activityId)
    selectView('phases')
    setLandingView('table')
    setActivePhaseId(phaseId)
    setExpandedPhases(prev => new Set(prev).add(phaseId))
    focusPhase(phaseId)
    setExpandedActivityIds(prev => new Set(prev).add(activityId))
    setMobileSidebarOpen(false)
    revealTarget(`activity-${activityId}`, 120, 'start')
  }

  /** Id-ul e al unui document trimis clientului (grupul lui, nu „Cereri generale”). */
  const isSentDocument = (id: string | null | undefined) =>
    !!id && allDocRequests.some((r: any) => r.id === id && r.is_outgoing)

  const handleSelectSent = () => {
    selectView('phases')
    setLandingView('table')
    setActivePhaseId(SENT_ID)
    focusPhase(SENT_ID)
    setMobileSidebarOpen(false)
    revealTarget(`phase-${SENT_ID}`, 120, 'start')
  }

  const handleSelectGeneral = () => {
    selectView('phases')
    setLandingView('table')
    setActivePhaseId(GENERAL_ID)
    setExpandedPhases(new Set([GENERAL_ID]))
    focusPhase(GENERAL_ID)
    setMobileSidebarOpen(false)
    revealTarget(`phase-${GENERAL_ID}`, 120, 'start')
  }

  // ─── Ascunderea celor finalizate (#109, A9) ─────────────────────────────────
  //
  // Doar la randare: fazele, activitățile și cererile vin întregi din API, deci
  // căutarea, contoarele, panoul lateral și „Panoul cu chei" văd tot (D10).
  // Implicit oprit și citit în efect, ca randarea de pe server și prima randare
  // din browser să fie aceleași.
  const [showFinal, setShowFinal] = useState(false)
  useEffect(() => {
    try { setShowFinal(window.localStorage.getItem(SHOW_FINAL_KEY) === '1') } catch { /* stocare indisponibilă */ }
  }, [])
  // Ținte dezvăluite: deep-link, căutare, salt din panou, chat, panoul lateral.
  // Rămân vizibile, cu tot cu părinții lor, până la următoarea comutare.
  const [revealedIds, setRevealedIds] = useState<Set<string>>(() => new Set())
  const reveal = useCallback((...ids: (string | null | undefined)[]) => {
    const fresh = ids.filter((id): id is string => !!id && id !== GENERAL_ID)
    if (fresh.length === 0) return
    setRevealedIds(prev => (fresh.every(id => prev.has(id)) ? prev : new Set([...prev, ...fresh])))
  }, [])
  const toggleShowFinal = (next: boolean) => {
    setShowFinal(next)
    setRevealedIds(new Set())
    try { window.localStorage.setItem(SHOW_FINAL_KEY, next ? '1' : '0') } catch { /* rămâne doar pentru sesiunea asta */ }
  }

  const hidden = useMemo(
    () => (showFinal ? NOTHING_HIDDEN : hiddenFinalItems(phases, allDocRequests, revealedIds)),
    [showFinal, phases, allDocRequests, revealedIds],
  )
  /** Câte rânduri ar ascunde comutatorul: cifra de lângă el. */
  const finalCount = useMemo(
    () => countHiddenRoots(hiddenFinalItems(phases, allDocRequests), phases, allDocRequests),
    [phases, allDocRequests],
  )
  /** Comutatorul apare dacă există ceva finalizat, nu după preferința salvată. */
  const showFinalToggle = useMemo(() => hasFinalItems(phases, allDocRequests), [phases, allDocRequests])
  const visiblePhases = useMemo(() => phases.filter(p => !hidden.phases.has(p.id)), [phases, hidden])

  // „Restrânge toate” lucrează pe grupurile vizibile, ca în monday: rămân doar
  // titlurile și sumarele, adică tot proiectul pe un ecran.
  const allGroupsCollapsed = visiblePhases.length > 0 && visiblePhases.every(p => collapsedGroups.has(p.id))

  // Faza aleasă, cât timp mai există: una ștearsă între timp lasă tabelul pe
  // toate fazele. Aleasă explicit, se arată și dacă e finalizată și ascunsă.
  const focusId = focusedPhaseId === GENERAL_ID || focusedPhaseId === SENT_ID || phases.some(p => p.id === focusedPhaseId) ? focusedPhaseId : null
  const tablePhases = focusId === GENERAL_ID || focusId === SENT_ID ? [] : focusId ? phases.filter(p => p.id === focusId) : visiblePhases
  const showAllPhases = () => {
    setFocusedPhaseId(null)
    setExpandedPhases(new Set())
    selectView('phases')
    setLandingView('table')
    setMobileSidebarOpen(false)
  }
  const handleToggleAllGroups = () => {
    setRenamingId(null)
    setCollapsedGroups(allGroupsCollapsed ? new Set() : new Set([...visiblePhases.map(p => p.id), GENERAL_ID, SENT_ID]))
  }

  const handleToggleActivity = (activityId: string) => {
    setExpandedActivityIds(prev => {
      const s = new Set(prev)
      if (s.has(activityId)) s.delete(activityId)
      else s.add(activityId)
      return s
    })
  }

  // Tabul trăiește în URL, deci se citește din URL de fiecare dată, nu doar la
  // montare: un deep-link din calendar schimbă doar parametrii aceleiași rute,
  // iar la Back pagina nu se remontează. Fără asta, adresa spunea „calendar" în
  // timp ce pe ecran rămâneau fazele, și Back părea că nu face nimic.
  //
  // Un deep-link e o cerere explicită către un element, deci decide el tabul —
  // în efectul de mai jos.
  useEffect(() => {
    if (hasDeepLink) return
    setActiveView(targetView === 'documents' || targetView === 'calendar' ? targetView : 'phases')
  }, [targetView, hasDeepLink])

  // Un deep-link ales din tabul „Calendar" schimbă doar parametrii aceleiași
  // rute, deci pagina nu se remontează și `fetchAll` nu mai rulează: tabul și
  // faza activă trebuie mutate aici, altfel selectarea unui eveniment n-ar
  // părea să facă nimic.
  //
  // O singură dată per link, ținut minte în `appliedDeepLink`: `phases` e în
  // dependențe fiindcă fazele sosesc după primul render, dar orice reîncărcare
  // ulterioară (o editare, o reînnoire de token) le înlocuiește cu un array nou
  // și ar fi reaplicat linkul — sărind utilizatorul înapoi în faza din URL și
  // redeschizând-o pe cea tocmai restrânsă.
  useEffect(() => {
    if (!targetPhaseId) {
      appliedDeepLink.current = null
      return
    }
    const deepLinkKey = `${targetPhaseId}:${targetActivityId}:${targetDocumentId}`
    if (appliedDeepLink.current === deepLinkKey) return
    // Numai pe o fază care chiar există: la prima încărcare fazele încă nu-s
    // aici și de asta se ocupă `fetchAll`, care face aceeași verificare. Un
    // link vechi, către o fază ștearsă între timp, nu trebuie să lase faza
    // activă pe un id inexistent.
    const known = targetPhaseId === GENERAL_ID || phases.some(phase => phase.id === targetPhaseId)
    if (!known) return
    appliedDeepLink.current = deepLinkKey
    // O notificare, un email de reminder sau calendarul pot trimite spre ceva
    // finalizat: ținta se dezvăluie, altfel pagina ar derula spre nimic.
    reveal(targetPhaseId, targetActivityId, targetDocumentId)
    setActiveView('phases')
    setLandingView('table')
    setActivePhaseId(targetPhaseId)
    setExpandedPhases(prev => (prev.has(targetPhaseId) ? prev : new Set(prev).add(targetPhaseId)))
    // Un document trimis clientului stă în grupul lui, nu în „Cereri generale”.
    focusPhase(targetPhaseId === GENERAL_ID && isSentDocument(targetDocumentId) ? SENT_ID : targetPhaseId)
  }, [targetPhaseId, targetActivityId, targetDocumentId, phases, reveal, focusPhase])

  // ─── Deep-link: scroll + highlight zona țintă din URL ───────────────────────
  useEffect(() => {
    const deepLinkKey = `${targetPhaseId}:${targetActivityId}:${targetDocumentId}`
    if (!targetPhaseId) {
      handledDeepLink.current = null
      return
    }
    if (handledDeepLink.current === deepLinkKey) return
    if (authLoading || loading || !profile || profileError || activePhaseId !== targetPhaseId) return
    const anchor = targetDocumentId
      ? `request-${targetDocumentId}`
      : targetActivityId
        ? `activity-${targetActivityId}`
        : targetPhaseId === GENERAL_ID ? 'general-requests' : `phase-${targetPhaseId}`

    if (targetActivityId) setExpandedActivityIds(prev => new Set(prev).add(targetActivityId))
    handledDeepLink.current = deepLinkKey
    revealTarget(anchor, 250)
    if (targetDocumentId) setSelectedDocumentRequestId(targetDocumentId)
  }, [authLoading, loading, profile, profileError, targetActivityId, targetPhaseId, targetDocumentId, activePhaseId, revealTarget])

  // Sari direct la o activitate (din panoul "Ce e de făcut"), fără reload.
  // Cu requestId, deschide direct fișa cererii — zero click-uri suplimentare
  // pentru client între "ce am de făcut" și zona de încărcare.
  const jumpToActivity = (phaseId: string | null, activityId: string | null, requestId?: string) => {
    reveal(phaseId, activityId, requestId)
    selectView('phases')
    setLandingView('table')
    focusPhase(activityId && phaseId ? phaseId : isSentDocument(requestId) ? SENT_ID : GENERAL_ID)
    if (activityId && phaseId) {
      // Document legat de o activitate dintr-o fază
      setActivePhaseId(phaseId)
      setExpandedPhases(new Set([phaseId]))
      setExpandedActivityIds(prev => new Set(prev).add(activityId))
    } else {
      // Cerere generală → secțiunea distinctă
      setActivePhaseId(GENERAL_ID)
      setExpandedPhases(new Set([GENERAL_ID]))
    }
    if (requestId) {
      setAutoOpenRequestId(requestId)
      setTimeout(() => setAutoOpenRequestId(null), 2500)
    }
    revealTarget(requestId ? `request-${requestId}` : activityId ? `activity-${activityId}` : 'general-requests')
  }

  // Stabil între rendere: altfel `documents`/`folders` din Drive se reconstruiesc
  // la fiecare render al paginii.
  const handleOpenDocumentRequest = useCallback((requestId: string) => {
    setSelectedDocumentRequestId(requestId)
  }, [])

  // `push` doar când utilizatorul chiar navighează — atunci butonul de back al
  // browserului (și gestul de back de pe telefon) trebuie să-l scoată din dosar.
  // Corectarea unui folder inexistent din URL folosește `replace`: cu `push` ar
  // adăuga o intrare în istoric, iar Back ar reveni pe URL-ul invalid, care s-ar
  // corecta din nou — o capcană din care back-ul n-ar mai ieși.
  const setDriveFolder = (folderId: string | null, mode: 'navigate' | 'correct' = 'navigate') => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('view', 'documents')
    if (folderId) params.set('folder', folderId)
    else params.delete('folder')
    const url = `/projects/${projectId}?${params.toString()}`
    if (mode === 'correct') router.replace(url, { scroll: false })
    else router.push(url, { scroll: false })
  }

  // ─── Derived ──────────────────────────────────────────────────────────────

  const phaseNameById = useMemo(
    () => new Map(phases.map(p => [p.id, p.name])),
    [phases]
  )

  const { pendingUploads, waitingOnClient } = useMemo(() => {
    // Clientul unui proiect încheiat nu mai are nimic „de făcut” (#109, D5), iar
    // personalul nu mai urmărește ce e la client. Ce a ajuns deja „În verificare”
    // rămâne însă în panoul personalului: încărcarea nu trimite nicio notificare,
    // iar Home și /my-requests nu mai arată proiectul, deci altfel n-ar apărea
    // nicăieri.
    if (projectClosed && isClient) return { pendingUploads: [], waitingOnClient: [] }
    const incoming = allDocRequests.filter((r: any) => !r.is_outgoing && !r.deleted_at)
    const deadlineTs = (r: { deadline_at: string | null }) => {
      const ts = r.deadline_at ? new Date(r.deadline_at).getTime() : Number.POSITIVE_INFINITY
      return Number.isNaN(ts) ? Number.POSITIVE_INFINITY : ts
    }
    const byDeadline = (a: { deadline_at: string | null }, b: { deadline_at: string | null }) => deadlineTs(a) - deadlineTs(b)
    const toPanelItem = (r: any) => {
      const phaseId = r.activity?.phase_id ?? null
      return {
        id: r.id,
        name: r.name,
        status: r.status,
        deadline_at: r.deadline_at ?? null,
        activity_id: r.activity?.id ?? r.activity_id ?? null,
        activity_name: r.activity?.name ?? null,
        phase_id: phaseId,
        phase_name: phaseId ? phaseNameById.get(phaseId) ?? null : null,
      }
    }
    return {
      pendingUploads: incoming
        .filter((r: any) => isClient ? (r.status === 'pending' || r.status === 'rejected') : r.status === 'review')
        .map(toPanelItem)
        .sort(byDeadline),
      waitingOnClient: isClient || projectClosed ? [] : incoming.filter((r: any) => r.status === 'pending').map(toPanelItem).sort(byDeadline),
    }
  }, [allDocRequests, phaseNameById, isClient, projectClosed])
  const actionNeededCount = pendingUploads.length + waitingOnClient.length

  const todayTs = useMemo(startOfToday, [])

  /** Cererile vii — fără documentele trimise clientului — pe activitate și pe
   *  fază. Din ele se trag starea fiecărui rând și sumarul fiecărui grup. */
  const { requestsByActivity, requestsByPhase } = useMemo(() => {
    const byActivity = new Map<string, any[]>()
    const byPhase = new Map<string, any[]>()
    for (const r of allDocRequests as any[]) {
      if (r.is_outgoing || r.deleted_at) continue
      const activityId = r.activity?.id ?? r.activity_id
      if (activityId) {
        const list = byActivity.get(activityId) ?? []
        list.push(r)
        byActivity.set(activityId, list)
      }
      const phaseId = r.activity?.phase_id ?? GENERAL_ID
      const list = byPhase.get(phaseId) ?? []
      list.push(r)
      byPhase.set(phaseId, list)
    }
    return { requestsByActivity: byActivity, requestsByPhase: byPhase }
  }, [allDocRequests])

  /** Starea fiecărei activități, în cuvântul celui care se uită. */
  const statusOf = (activity: ProjectActivity) =>
    activityStatus(activity, requestsByActivity.get(activity.id) ?? [], todayTs, isClient)

  /** Tooltip-ul activității din panou: aceeași stare ca în tabel (S-17). */
  const activityHint = (activity: ProjectActivity) => {
    const go = 'Clic: o deschide în tabel.'
    if (canEdit && activity.visibility !== 'published') return `În pregătire: clientul n-o vede încă. ${go}`
    const { label } = statusOf(activity)
    if (label === 'Finalizată') return `Finalizată. ${go}`
    return `${label}${activity.deadline_at ? ` · termen ${formatShortDate(activity.deadline_at)}` : ''} — ${go}`
  }

  // Coloanele tabelului: „Vizibil clientului” e a echipei, „⋯” a cui poate modifica.
  const tableColumns = { visibility: canEdit, actions: canChange }
  const tableLabels = [
    'Responsabil', 'Status', 'Documente', 'Termen',
    ...(canEdit ? ['Vizibil clientului'] : []),
    ...(canChange ? [''] : []),
  ]

  /** Bateria unui grup: activitățile numărate pe stare, de la ce e gata la ce arde. */
  const summarySegments = (activities: ProjectActivity[]): SummarySegment[] => {
    const order: SignalTone[] = ['ok', 'review', 'pending', 'neutral', 'danger']
    const byLabel = new Map<string, SummarySegment>()
    for (const activity of activities) {
      const { tone, label } = statusOf(activity)
      const segment = byLabel.get(label) ?? { tone, label, count: 0 }
      segment.count++
      byLabel.set(label, segment)
    }
    return [...byLabel.values()].sort((a, b) => order.indexOf(a.tone) - order.indexOf(b.tone))
  }

  // Un grup selectat rămâne vizibil și gol, ca să poată explica lipsa conținutului.
  const showGeneralGroup = focusId === GENERAL_ID || canChange || allDocRequests.some((r: any) => !r.deleted_at && !r.is_outgoing && !(r.activity?.id ?? r.activity_id))
  const showSentGroup = focusId === SENT_ID || canChange || allDocRequests.some((r: any) => !r.deleted_at && r.is_outgoing)
  const sentTitle = isClient ? 'Documente de la consultant' : 'Documente trimise clientului'
  const [sendOpen, setSendOpen] = useState(false)

  /** Ce arde în fiecare fază, pentru panoul de faze. Clientul vede doar ce ține
   *  de el (termen depășit sau respins); „de verificat” e treaba echipei. Un
   *  proiect încheiat n-are nimic de făcut, deci nu semnalează nimic. */
  const phaseSignals = useMemo(() => {
    const signals = new Map<string, { danger: number; review: number }>()
    if (projectClosed) return signals
    for (const [phaseId, requests] of requestsByPhase) {
      let danger = 0
      let review = 0
      for (const request of requests) {
        const tone = requestTone(request, todayTs)
        if (tone === 'danger') danger++
        else if (tone === 'review' && !isClient) review++
      }
      if (danger > 0 || review > 0) signals.set(phaseId, { danger, review })
    }
    return signals
  }, [requestsByPhase, todayTs, projectClosed, isClient])

  const searchIndex = useMemo(() => buildSearchIndex(phases, allDocRequests), [phases, allDocRequests])

  const handleSearchSelect = (result: SearchResult) => {
    if (result.type === 'phase') {
      reveal(result.id)
      selectView('phases')
      setLandingView('table')
      setExpandedPhases(new Set([result.id]))
      focusPhase(result.id)
      revealTarget(`phase-${result.id}`)
      return
    }
    if (result.type === 'activity') {
      jumpToActivity(result.phaseId, result.activityId)
      return
    }
    // document_request — deschide și fișa cererii, odată ce faza/activitatea e vizibilă
    jumpToActivity(result.phaseId, result.activityId, result.id)
  }

  const handleChatNavigate = (result: SearchResult) => {
    setChatOpen(false)
    const phaseId = result.type === 'phase' ? result.id : result.phaseId ?? GENERAL_ID
    const deepLinkKey = `${phaseId}:${result.activityId}:${result.type === 'document_request' ? result.id : null}`
    appliedDeepLink.current = deepLinkKey
    handledDeepLink.current = deepLinkKey
    reveal(phaseId, result.activityId, result.type === 'document_request' ? result.id : null)
    setActiveView('phases')
    setLandingView('table')
    setActivePhaseId(phaseId)
    setExpandedPhases(prev => new Set(prev).add(phaseId))
    focusPhase(phaseId)
    if (result.activityId) {
      setExpandedActivityIds(prev => new Set(prev).add(result.activityId!))
    }
    if (result.type === 'document_request') {
      // Fișa cererii acoperă pagina, deci inelul desenat acum s-ar consuma sub
      // ea. Îl amânăm până se închide modalul, ca userul să vadă atunci din ce
      // activitate venea cererea.
      setSelectedDocumentRequestId(result.id)
      pendingRevealAnchor.current = `request-${result.id}`
    } else {
      revealTarget(result.type === 'activity' ? `activity-${result.id}` : `phase-${result.id}`)
    }
    if (!projectId) return
    // `replace`, ca peste tot altundeva în pagină: cu `push`, o plimbare prin
    // cinci linkuri din chat cerea cinci apăsări de Back ca să ieși din proiect.
    router.replace(buildProjectChatHref(projectId, result), { scroll: false })
  }

  // ─── Loading / error ──────────────────────────────────────────────────────

  if (!authLoading && profileError) {
    return (
      <div className="flex h-screen items-center justify-center bg-paper" role="alert">
        <div className="text-center">
          <AlertCircle className="mx-auto mb-3 h-12 w-12" style={{ color: 'var(--sg-danger)' }} aria-hidden="true" />
          <h2 className="mb-4 text-lg font-semibold text-ink">Nu am putut încărca profilul tău.</h2>
          <button type="button" onClick={() => window.location.reload()}
            className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-plate)] bg-[var(--sg-accent)] px-4 text-sm font-semibold text-white pointer-fine:min-h-10">
            Reîncarcă pagina
          </button>
        </div>
      </div>
    )
  }

  if (authLoading || loading || !profile) {
    return (
      <div className="flex h-screen items-center justify-center bg-paper" role="status" aria-live="polite">
        <div className="flex flex-col items-center gap-3">
          <Spinner />
          <p className="text-sm text-ink-soft">Se încarcă proiectul…</p>
        </div>
      </div>
    )
  }

  // `projectId` intră în gardă alături de proiect, ca restul paginii să-l poată
  // folosi ca `string`. Fără el, `CalendarSurface` ar fi căzut pe calendarul
  // general și ar fi arătat, în pagina unui proiect, termenele tuturor.
  if (!project || !projectId) {
    return (
      <div className="flex h-screen items-center justify-center bg-paper" role="status" aria-live="polite">
        <div className="text-center">
          <AlertCircle className="mx-auto mb-3 h-12 w-12" style={{ color: 'var(--sg-danger)' }} aria-hidden="true" />
          <h2 className="mb-4 text-lg font-semibold text-ink">Proiectul nu există sau nu ai acces la el</h2>
          <button data-tooltip="Înapoi la lista de proiecte" onClick={() => router.push('/')}
            className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-plate)] bg-[var(--sg-accent)] px-4 text-sm font-semibold text-white sm:min-h-10">
            <ArrowLeft className="w-4 h-4" /> Înapoi
          </button>
        </div>
      </div>
    )
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="project-scope flex min-h-screen flex-col text-ink">

      {/* Fâșia de locație. Înainte, pagina își desena propria bară de
          navigare sub cea a aplicației — două bare una peste alta, cu o dungă
          moartă între ele. Acum e una singură, iar acțiunile proiectului stau
          la dreapta ei. */}
      <LocationStrip
        segments={[{ label: 'Proiecte', href: '/' }, { label: project.title }]}
        action={
          <>
            {perms.edit_project && !isEditingTitle && (
              // Pe telefon, redenumirea stă în „⋯”: bara nu încăpea pe un rând.
              <IconButton className="max-sm:hidden" label="Redenumește proiectul" data-tooltip="Schimbă numele proiectului" onClick={() => { setEditTitle(project.title); setIsEditingTitle(true) }}>
                <Pencil className="h-4 w-4" />
              </IconButton>
            )}
            {/* Doar pe telefon, unde panoul e sertar: pe calculator panoul are
                propriile butoane de strâns și deschis, iar acesta nu făcea nimic (S-07). */}
            <IconButton className="md:hidden" label="Toate fazele: reordonare, activități, echipă" data-tooltip="Panoul fazelor: alege o fază, reordonează, adaugă" onClick={openPhasesPanel}>
              <Layers className="h-4 w-4" />
            </IconButton>
            <IconButton label="Caută în proiect" data-tooltip="Caută în proiect: faze, activități, cereri  ·  tasta /" onClick={() => setSearchOpen(true)}>
              <Search className="h-4 w-4" />
            </IconButton>
            {!isClient && (
              <ProjectTeam
                projectId={projectId}
                members={projectMembers}
                canManage={perms.manage_team}
                canRemoveAny={perms.remove_any_member}
                closed={projectClosed}
                onChange={fetchProjectMembers}
              />
            )}
            {canChange && (
              <Button
                variant={hasUnnotifiedUpdates ? 'primary' : 'secondary'}
                size="sm"
                onClick={handleNotifyClient}
                aria-label="Anunță clientul despre actualizări"
                disabled={!hasUnnotifiedUpdates || notifyingClient}
                title={hasUnnotifiedUpdates ? 'Anunță clientul despre actualizări: noutăți publicate și documente verificate' : 'Nicio actualizare de anunțat'}
              >
                {notifyingClient ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Megaphone className="h-4 w-4" aria-hidden="true" />}
                <span className="hidden sm:inline">Anunță clientul</span>
              </Button>
            )}
            {/* Pornite, reminderele sunt o iconiță ca oricare alta; oprite, se
                fac plăcuță cu text. Starea neobișnuită e cea care merită
                spațiu — altfel butonul ar striga pe fiecare proiect normal. */}
            {permissions.edit_project && (
              automaticRemindersEnabled(project) ? (
                <IconButton
                  label={remindersActionLabel(true)}
                  title={projectClosed ? PROJECT_CLOSED_REMINDERS_HINT : 'Reminderele automate sunt pornite. Apasă ca să le oprești.'}
                  disabled={togglingReminders || projectClosed}
                  onClick={handleToggleAutomaticReminders}
                  // Pornite, pe telefon stau în „⋯”; oprite, plăcuța rămâne la vedere.
                  className="disabled:cursor-not-allowed disabled:opacity-55 max-sm:hidden"
                >
                  {togglingReminders ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
                </IconButton>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={togglingReminders || projectClosed}
                  onClick={handleToggleAutomaticReminders}
                  title={projectClosed ? PROJECT_CLOSED_REMINDERS_HINT : 'Reminderele automate sunt oprite. Apasă ca să le pornești.'}
                  aria-label={remindersActionLabel(false)}
                  className="border-[var(--sg-warn)] bg-[var(--sg-warn-soft)] text-[var(--sg-warn)]"
                >
                  {togglingReminders ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <BellOff className="h-4 w-4" aria-hidden="true" />}
                  <span className="hidden sm:inline">Remindere oprite</span>
                </Button>
              )
            )}
            <span data-tooltip="Clientul proiectului" className="hidden items-center gap-1.5 rounded-[var(--radius-plate)] bg-paper-sunk px-2.5 py-1 text-xs text-ink-soft lg:flex">
              <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
              {profileDisplayName(project.profiles, project.profiles?.full_name || 'Client')}
            </span>
            {/* Acțiunile rare ale proiectului stau sub „⋯": încheierea nu e un
                buton de apăsat zilnic. Meniul nu apare deloc cui n-are voie. */}
            <RowActionsMenu
              label="Mai multe acțiuni"
              tooltip="Mai multe acțiuni"
              busy={changingLifecycle}
              triggerClassName="inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-plate)] text-ink-faint transition-colors duration-[120ms] hover:bg-paper-sunk hover:text-ink disabled:opacity-60 pointer-fine:h-9 pointer-fine:w-9"
              actions={[
                {
                  label: 'Redenumește proiectul',
                  icon: <Pencil className="h-4 w-4" />,
                  hidden: !perms.edit_project || isEditingTitle,
                  mobileOnly: true,
                  onSelect: () => { setEditTitle(project.title); setIsEditingTitle(true) },
                },
                {
                  label: remindersActionLabel(true),
                  icon: <BellOff className="h-4 w-4" />,
                  hidden: !permissions.edit_project || projectClosed || !automaticRemindersEnabled(project),
                  mobileOnly: true,
                  onSelect: () => { void handleToggleAutomaticReminders() },
                },
                {
                  label: 'Încheie proiectul',
                  icon: <Archive className="h-4 w-4" />,
                  hidden: !permissions.close_project || projectClosed,
                  onSelect: () => { void handleProjectLifecycle('close') },
                },
                {
                  label: 'Redeschide proiectul',
                  icon: <RotateCcw className="h-4 w-4" />,
                  hidden: !permissions.close_project || !projectClosed,
                  onSelect: () => { void handleProjectLifecycle('reopen') },
                },
              ]}
            />
          </>
        }
      />

      {/* Titlul paginii. Numele proiectului se vede deja în fâșia de locație,
          deci titlul mare a ieșit (cererea clientului, 20 octombrie 2026) și
          tabelul urcă sub ea. `h1` rămâne pentru cititoarele de ecran: fâșia e
          navigație, nu titlu. Ce se vede aici e doar starea „încheiat”. */}
      <h1 className="sr-only">{project.title}</h1>
      {!isEditingTitle && projectClosed && (
        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          {/* Clientul vede data, nu și cine a încheiat: ruta nu-i trimite numele. */}
          <Signal tone="closed">
            {projectClosedLabel(project.closed_at, project.closer?.full_name)}
          </Signal>
          <p className="basis-full text-sm text-ink-soft">
            {isClient
              ? 'Proiectul e încheiat; nu mai e nevoie să încarci nimic.'
              : permissions.close_project
                ? 'Se poate doar consulta. Ca să modifici ceva, redeschide-l din „Mai multe acțiuni”.'
                : 'Se poate doar consulta, până îl redeschide un administrator sau un consultant senior din echipă.'}
          </p>
        </div>
      )}

      {isEditingTitle && (
        <div ref={titleEditorRef} className="mb-4 flex items-center gap-2">
          <input
            value={editTitle}
            onChange={e => setEditTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSaveTitle(); if (e.key === 'Escape') setIsEditingTitle(false) }}
            autoFocus
            disabled={saving}
            aria-label="Titlul proiectului"
            className="h-11 min-w-0 flex-1 rounded-[var(--radius-plate)] border border-rule bg-plate px-3 text-sm font-semibold text-ink focus:border-[var(--sg-accent)] sm:h-10"
          />
          <Button data-tooltip="Salvează noul nume al proiectului" variant="primary" size="sm" onClick={handleSaveTitle} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
            Salvează
          </Button>
          <Button data-tooltip="Păstrează numele vechi" variant="quiet" size="sm" onClick={() => setIsEditingTitle(false)}>Renunță</Button>
        </div>
      )}

      {/* ── Body: sidebar + main ── */}
      {/* Fără a doua margine: containerul paginii o are deja. Panoul și
          conținutul se aliniază cu titlul, iar pe telefon conținutul ia toată
          lățimea. Spațiul dintre panou și conținut vine din `md:px-6`. */}
      <div className="flex flex-1 w-full">

        {/* Sidebar-ul nu mai e navigație: numele se tăiau și nu se puteau
            deosebi două faze. Navigarea trăiește în panou și în coridorul de
            faze; aici rămâne doar panoul de reordonare, activități și echipă,
            deschis la cerere. */}
        {activeView === 'phases' && (
          <ProjectPhasesSidebar
            phases={phases}
            activePhaseId={landingView === 'table' ? focusedPhaseId : null}
            expandedPhases={expandedPhases}
            canEdit={canEdit}
            readOnly={projectClosed}
            projectId={projectId}
            documentRequests={allDocRequests}
            isGeneralActive={landingView === 'table' && focusedPhaseId === GENERAL_ID}
            onShowAll={showAllPhases}
            showingAll={landingView === 'table' && !focusId}
            onSelectPhase={handleSelectPhase}
            onSelectActivity={handleSelectActivity}
            onSelectGeneral={handleSelectGeneral}
            sent={showSentGroup ? { label: sentTitle, active: landingView === 'table' && focusedPhaseId === SENT_ID, onSelect: handleSelectSent } : undefined}
            phaseSignals={phaseSignals}
            generalId={GENERAL_ID}
            onToggleExpand={handleToggleExpand}
            onRefresh={fetchAll}
            onReorderRefresh={refreshPhases}
            onDuplicateRefresh={refreshContent}
            apiFetch={apiFetch}
            permissions={perms}
            mobileOpen={mobileSidebarOpen}
            onMobileClose={() => setMobileSidebarOpen(false)}
            collapsed={sidebarCollapsed}
            activityHint={activityHint}
            onCollapsedChange={next => { changeSidebarCollapsed(next); setMobileSidebarOpen(false) }}
          />
        )}

        {/* ══ MAIN ══ */}
        <main className="flex-1 min-w-0">

          {/* Bara de unelte rămâne la vedere pe calculator: taburile și, pe
              „Faze & Activități”, comutatorul panou / de făcut. Pagina se
              derulează în continuare normal — pe telefon, la zoom mare sau cu
              Ctrl+F nimic nu se schimbă; doar bara se lipește sub navigare. */}
          <div className="md:sticky md:top-16 md:z-20 md:bg-paper">
          {/* ── Tab switcher ── */}
          <div className="relative z-10 flex h-11 items-center gap-2 bg-[var(--p-surface)] border-b border-[var(--p-border)] md:px-3">
            {activeView === 'phases' && sidebarCollapsed && (
              <button
                type="button"
                onClick={() => changeSidebarCollapsed(false)}
                aria-label="Arată panoul fazelor"
                data-tooltip="Arată panoul fazelor"
                className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-plate)] text-ink-soft transition-colors duration-[120ms] hover:bg-paper-sunk hover:text-ink md:inline-flex"
              >
                <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
            <div className="flex h-full min-w-0 flex-1 gap-1 -mb-px overflow-x-auto">
              {([
                { view: 'phases', label: 'Faze & Activități', Icon: Layers, count: 0, urgent: false, hint: '', tip: 'Fazele proiectului, cu activitățile și cererile de documente' },
                {
                  view: 'documents',
                  label: 'Documente',
                  Icon: FolderOpen,
                  count: documentEntriesCount,
                  urgent: false,
                  hint: `${documentEntriesCount} fișiere`,
                  tip: 'Toate fișierele proiectului, pe dosare — câte unul pe fază',
                },
                {
                  view: 'calendar',
                  label: 'Calendar',
                  Icon: CalendarDays,
                  count: calendarUrgentCount,
                  urgent: true,
                  hint: `${calendarUrgentCount} termene depășite sau în următoarele 7 zile`,
                  tip: calendarUrgentCount > 0
                    ? `Termenele proiectului — ${calendarUrgentCount} depășite sau în următoarele 7 zile`
                    : 'Termenele proiectului, pe zile',
                },
              ] as const).map(({ view, label, Icon, count, urgent, hint, tip }) => (
                <button
                  key={view}
                  data-tooltip={tip}
                  onClick={() => selectView(view)}
                  aria-current={activeView === view ? 'page' : undefined}
                  className={`flex h-full items-center gap-2 px-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                    activeView === view
                      ? 'border-[var(--sg-accent)] text-[var(--sg-accent-ink)]'
                      : 'border-transparent text-ink-soft hover:text-ink'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                  {/* `aria-label` pe un `span` fără rol e ignorat: la cititorul
                      de ecran ar fi ajuns doar cifra, iar urgența ar fi rămas
                      spusă exclusiv prin culoare. Deci cifra e decorativă, iar
                      explicația se citește dintr-un text ascuns vizual. */}
                  {count > 0 && (
                    <>
                      <span
                        aria-hidden
                        className={`text-xs px-1.5 rounded-[var(--radius-plate)] font-medium tabular-nums ${
                          urgent ? 'bg-[var(--sg-danger-soft)] text-[var(--sg-danger)]' : 'bg-paper-sunk text-ink-soft'
                        }`}
                      >
                        {count}
                      </span>
                      <span className="sr-only">{hint}</span>
                    </>
                  )}
                </button>
              ))}
            </div>
            {/* Chatul stă în bara care rămâne la vedere la derulare: e drumul
                cel mai des folosit din proiect (feedback-ul lui Sandu, 22
                octombrie 2026). */}
            <Button
              variant="secondary"
              size="sm"
              onClick={handleOpenChat}
              className="relative shrink-0"
              data-tooltip={isClient ? 'Scrie-i consultantului despre acest proiect' : 'Discuția proiectului, cu echipa și cu clientul'}
              aria-label={unreadCount > 0 ? `Chat, ${unreadCount} mesaje necitite` : 'Chat'}
            >
              <MessageSquare className="h-4 w-4" aria-hidden="true" />
              {/* Pe telefon doar iconița: altfel taburile nu mai încap. */}
              <span className="hidden sm:inline">Chat</span>
              {unreadCount > 0 && <Counter n={unreadCount} label={`${unreadCount} mesaje necitite`} className="ml-1" />}
            </Button>
          </div>

            {/* Bara tabelului, ca în monday: vederea la stânga, uneltele la
                dreapta. „Ce ai de făcut” își poartă numărul — e o poartă spre
                lista de rezolvat, nu un ornament. */}
            {activeView === 'phases' && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-3 md:px-6 md:pb-2">
                <div role="group" aria-label="Vederea fazelor" className="inline-flex rounded-[var(--radius-plate-lg)] bg-paper-sunk p-0.5">
                  {([
                    { view: 'table', label: 'Tabel principal', Icon: Table2, tip: 'Tot proiectul ca tabel: faze, activități, cereri' },
                    {
                      view: 'action-needed',
                      label: 'Ce ai de făcut',
                      Icon: ListTodo,
                      tip: isClient ? 'Documentele pe care le ai de încărcat' : 'Ce așteaptă după tine: documente de verificat, apoi ce e încă la client',
                    },
                  ] as const).map(({ view, label, Icon, tip }) => (
                    <button
                      key={view}
                      data-tooltip={tip}
                      type="button"
                      aria-pressed={landingView === view}
                      onClick={() => {
                        setRenamingId(null)
                        // Altă vedere pornește de sus, nu de la derularea celeilalte.
                        if (view !== landingView) window.scrollTo({ top: 0 })
                        setLandingView(view)
                      }}
                      className={`inline-flex min-h-10 items-center gap-1.5 rounded-[var(--radius-plate)] border px-3 text-[13px] font-semibold transition-colors duration-[120ms] pointer-fine:min-h-8 ${
                        landingView === view
                          ? 'border-rule bg-plate text-ink'
                          : 'border-transparent text-ink-soft hover:text-ink'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                      {label}
                      {view === 'action-needed' && actionNeededCount > 0 && <Counter n={actionNeededCount} className="ml-0.5" />}
                    </button>
                  ))}
                </div>
                {landingView === 'table' && phases.length > 0 && (
                  <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1">
                    {/* Apare cât proiectul are ceva finalizat. Nu depinde de
                        preferința salvată (aceeași pe toate proiectele) și nici
                        de cifră: o activitate finalizată cu cereri deschise
                        rămâne la vedere, iar comutatorul dispărea la propriul
                        clic (S-13, feedback-ul lui Sandu). */}
                    {showFinalToggle && (
                      <label
                        data-tooltip={finalCount > 0
                          ? 'Arată și fazele, activitățile și cererile încheiate, ascunse ca să nu încurce'
                          : 'Nimic ascuns acum: elementele finalizate mai au cereri deschise, deci rămân la vedere.'}
                        className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-ink-soft pointer-fine:min-h-8"
                      >
                        <input
                          type="checkbox"
                          checked={showFinal}
                          onChange={event => toggleShowFinal(event.target.checked)}
                          // 24px: ținta minimă WCAG 2.5.8, și cu mausul.
                          className="h-6 w-6 rounded-[1px] border-rule-strong text-[var(--sg-accent)]"
                        />
                        Arată și ce e finalizat
                        {!showFinal && finalCount > 0 && (
                          <span className="text-ink-faint">({finalCount})</span>
                        )}
                      </label>
                    )}
                    {/* Cu o fază aleasă, drumul înapoi e la vedere; „Restrânge
                        toate” n-are sens pe un singur grup. */}
                    {focusId ? (
                      <Button variant="secondary" size="sm" onClick={showAllPhases} data-tooltip="Înapoi la tot proiectul, cu toate fazele">
                        <Layers className="h-4 w-4" aria-hidden="true" />
                        Arată toate fazele
                      </Button>
                    ) : (
                      <Button
                        variant="quiet"
                        size="sm"
                        onClick={handleToggleAllGroups}
                        data-tooltip={allGroupsCollapsed ? 'Deschide toate fazele, cu activitățile lor' : 'Lasă doar titlul și sumarul fiecărei faze — tot proiectul pe un ecran'}
                      >
                        {allGroupsCollapsed
                          ? <ChevronsUpDown className="h-4 w-4" aria-hidden="true" />
                          : <ChevronsDownUp className="h-4 w-4" aria-hidden="true" />}
                        {allGroupsCollapsed ? 'Extinde toate grupurile' : 'Restrânge toate grupurile'}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Content ── */}
          {activeView === 'calendar' ? (
            <div className="max-w-5xl py-4 md:px-6">
              <CalendarSurface projectId={projectId} />
            </div>
          ) : activeView === 'documents' ? (
            <ProjectDocumentsView
              projectId={projectId}
              requests={allDocRequests}
              phases={phases}
              error={documentsError}
              onRetry={refreshDocs}
              activeFolderId={targetFolderId}
              onFolderChange={setDriveFolder}
              // Clientul n-are ce face în fișa cererii — încărcarea trăiește în
              // „Faze & Activități", nu în modal. Fără handler, rândul nu se deschide.
              onOpenRequest={canEdit ? handleOpenDocumentRequest : undefined}
            />
          ) : landingView === 'action-needed' ? (
            <ActionNeededPanel items={pendingUploads} waitingItems={waitingOnClient} isClient={isClient} projectClosed={projectClosed} onJump={jumpToActivity} />
          ) : (
            // Învelișul e containerul după care tabelul își alege forma: pe
            // coloane când are loc, pe fișe când nu (vezi `project-table/cells`).
            <div className="@container py-4 md:px-6">
              {phases.length === 0 && !focusId && (
                <div className="mb-7 rounded-[var(--radius-plate)] border border-dashed border-rule-strong px-6 py-12 text-center">
                  <p className="text-base font-semibold text-ink">{isClient ? 'Nicio fază publicată încă' : 'Proiectul n-are încă faze'}</p>
                  <p className="mx-auto mt-2 max-w-[52ch] text-sm leading-6 text-ink-soft">
                    {isClient
                      ? 'Fazele și activitățile vor apărea aici după ce sunt publicate.'
                      : 'Importă un șablon ca să apară fazele și activitățile, cu cererile de documente organizate pe ele.'}
                  </p>
                </div>
              )}
              <div className="space-y-7">
                {tablePhases.map(phase => {
                  const band = bandFor(phases.findIndex(p => p.id === phase.id))
                  const activities = phase.activities ?? []
                  const shownActivities = activities.filter(activity => !hidden.activities.has(activity.id))
                  const hiddenActivities = activities.filter(activity => hidden.activities.has(activity.id))
                  const phaseRequests = requestsByPhase.get(phase.id) ?? []
                  return (
                    <TableGroup
                      key={phase.id}
                      id={phase.id}
                      title={phase.name}
                      band={band}
                      draft={canEdit && phase.visibility !== 'published'}
                      collapsed={collapsedGroups.has(phase.id)}
                      onToggle={() => toggleGroup(phase.id)}
                      columns={activityColumnsTemplate(tableColumns)}
                      meta={progressLabel(phaseProgress(phase), 'activitate', 'activități')}
                      badges={
                        <>
                          {isPhaseFinal(phase) && <Signal tone="ok">Finalizată</Signal>}
                          <PublishStatusControl
                            status={phase.visibility ?? 'draft'}
                            canPublish={canChange}
                            showPublishedStatus={canEdit}
                            size="sm"
                            compact={phase.visibility === 'published'}
                            visibleTooltip="Faza e vizibilă clientului"
                            onPublish={() => publishProjectItem(`/api/projects/${projectId}/phases/${phase.id}`, {
                              title: 'Publică faza?',
                              description: 'Faza va deveni vizibilă clientului. Activitățile și cererile deja publicate din această fază vor deveni vizibile.',
                            })}
                          />
                        </>
                      }
                      actions={canChange ? (
                        <RowActionsMenu
                          label={`Acțiuni pentru faza ${phase.name}`}
                          tooltip="Acțiuni fază"
                          busy={duplicatingId === phase.id || deletingId === phase.id || completingId === phase.id}
                          actions={[
                            {
                              label: 'Marchează faza ca finalizată',
                              icon: <CheckCircle2 className="w-3 h-3" />,
                              hidden: !perms.complete_items || isPhaseFinal(phase),
                              onSelect: () => { void handleItemCompletion('complete', phase) },
                            },
                            {
                              label: 'Readu faza în lucru',
                              icon: <RotateCcw className="w-3 h-3" />,
                              hidden: !perms.complete_items || !isPhaseFinal(phase),
                              onSelect: () => { void handleItemCompletion('reopen', phase) },
                            },
                            {
                              label: 'Redenumește',
                              icon: <Pencil className="w-3 h-3" />,
                              onSelect: () => setRenamingId(phase.id),
                            },
                            {
                              label: 'Duplică',
                              icon: <Copy className="w-3 h-3" />,
                              onSelect: () => { void handleDuplicatePhase(phase.id, phase.name) },
                            },
                            {
                              label: 'Șterge',
                              icon: <Trash2 className="w-3 h-3" />,
                              danger: true,
                              hidden: !perms.delete_phases,
                              onSelect: () => { void askToDeletePhase(phase) },
                            },
                          ]}
                        />
                      ) : undefined}
                      renaming={renamingId === phase.id}
                      renameLoading={savingRename === phase.id}
                      onRenameSubmit={name => { void renameItem(`/api/projects/${projectId}/phases/${phase.id}`, phase.id, name) }}
                      onRenameCancel={() => setRenamingId(null)}
                      header={activities.length > 0 ? <ColumnHeader first="Activitate" labels={tableLabels} /> : undefined}
                      summary={activities.length > 0 ? (
                        <GroupSummary
                          columns={tableColumns}
                          segments={summarySegments(activities)}
                          docs={{ done: phaseRequests.filter(isRequestFinal).length, total: phaseRequests.length }}
                          range={deadlineRange(activities.filter(activity => !isActivityFinal(activity)).map(activity => activity.deadline_at), todayTs)}
                        />
                      ) : undefined}
                    >
                      {activities.length === 0 && !canChange && (
                        <p className="px-3 py-3 text-sm text-ink-soft">{isClient ? 'Nicio activitate publicată în această fază încă.' : 'Nicio activitate în această fază.'}</p>
                      )}
                      {shownActivities.map(activity => (
                        <ActivityRow
                          key={activity.id}
                          activity={activity}
                          columns={tableColumns}
                          band={band}
                          status={statusOf(activity)}
                          completed={isActivityFinal(activity)}
                          progress={activityProgress(activity.id, allDocRequests)}
                          open={expandedActivityIds.has(activity.id)}
                          onToggle={() => handleToggleActivity(activity.id)}
                          canAssign={canChange}
                          projectMembers={projectMembers}
                          onAssign={assignedTo => { handleAssignActivity(phase.id, activity.id, assignedTo).catch(() => {}) }}
                          canPublish={canChange}
                          showPublishedStatus={canEdit}
                          publishBlockers={publishBlockers({
                            kind: 'activity',
                            currentDeadline: activity.deadline_at,
                            currentAssignee: activity.assigned_to,
                          })}
                          onSetDeadline={canChange ? date => saveActivityDeadline(phase.id, activity.id, date) : undefined}
                          onPublish={() => publishProjectItem(`/api/projects/${projectId}/phases/${phase.id}/activities/${activity.id}`, {
                            title: 'Publică activitatea?',
                            description: phase.visibility === 'published'
                              ? 'Activitatea va deveni vizibilă clientului.'
                              : `Activitatea va fi publicată, dar clientul o va vedea doar după ce publici faza „${phase.name}”.`,
                          })}
                          actions={canChange ? (
                            <RowActionsMenu
                              label={`Acțiuni pentru activitatea ${activity.name}`}
                              tooltip="Acțiuni activitate"
                              busy={duplicatingId === activity.id || deletingId === activity.id || completingId === activity.id}
                              actions={[
                                {
                                  label: 'Marchează activitatea ca finalizată',
                                  icon: <CheckCircle2 className="w-3 h-3" />,
                                  hidden: !perms.complete_items || isActivityFinal(activity),
                                  onSelect: () => { void handleItemCompletion('complete', phase, activity) },
                                },
                                {
                                  label: 'Readu activitatea în lucru',
                                  icon: <RotateCcw className="w-3 h-3" />,
                                  hidden: !perms.complete_items || !isActivityFinal(activity),
                                  onSelect: () => { void handleItemCompletion('reopen', phase, activity) },
                                },
                                {
                                  label: 'Redenumește',
                                  icon: <Pencil className="w-3 h-3" />,
                                  onSelect: () => setRenamingId(activity.id),
                                },
                                {
                                  label: 'Duplică',
                                  icon: <Copy className="w-3 h-3" />,
                                  onSelect: () => { void handleDuplicateActivity(phase.id, activity.id, activity.name) },
                                },
                                {
                                  label: 'Șterge',
                                  icon: <Trash2 className="w-3 h-3" />,
                                  danger: true,
                                  hidden: !perms.delete_phases,
                                  onSelect: () => { void askToDeleteActivity(phase, activity) },
                                },
                              ]}
                            />
                          ) : undefined}
                          renaming={renamingId === activity.id}
                          renameLoading={savingRename === activity.id}
                          onRenameSubmit={name => { void renameItem(`/api/projects/${projectId}/phases/${phase.id}/activities/${activity.id}`, activity.id, name) }}
                          onRenameCancel={() => setRenamingId(null)}
                        >
                          <DocumentRequests
                            projectId={projectId}
                            activityId={activity.id}
                            activityName={activity.name}
                            parentActivityVisibility={activity.visibility}
                            parentActivityAssignee={activity.assigned_to}
                            parentPhaseName={phase.name}
                            parentPhaseVisibility={phase.visibility}
                            projectMembers={projectMembers}
                            externalRequests={allDocRequests}
                            onRefresh={refreshDocs}
                            clientEmail={project?.profiles?.email ?? null}
                            clientName={project?.profiles?.full_name ?? null}
                            projectTitle={project?.title}
                            autoOpenRequestId={autoOpenRequestId}
                            canCloseRequests={perms.complete_items}
                            readOnly={projectClosed}
                            hiddenRequestIds={hidden.requests}
                            onRevealRequests={ids => reveal(...ids)}
                          />
                        </ActivityRow>
                      ))}
                      <HiddenFinalRow
                        className="border-b border-rule px-3 py-1"
                        hiddenCount={hiddenActivities.length}
                        total={activities.length}
                        singular="activitate"
                        plural="activități"
                        onReveal={() => reveal(...hiddenActivities.map(activity => activity.id))}
                        focusTargetId={hiddenActivities[0] ? `activity-${hiddenActivities[0].id}` : undefined}
                      />
                      {canChange && (
                        showAddActivity[phase.id] ? (
                          <div className="border-b border-rule px-2 py-1.5">
                            <InlineInput
                              size="md"
                              placeholder="Nume activitate..."
                              label="Numele activității noi"
                              loading={!!addingActivity[phase.id]}
                              onConfirm={name => { void handleAddActivity(phase.id, name) }}
                              onCancel={() => setShowAddActivity(prev => ({ ...prev, [phase.id]: false }))}
                            />
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setShowAddActivity(prev => ({ ...prev, [phase.id]: true }))}
                            data-tooltip={`Adaugă o activitate nouă în faza „${phase.name}”`}
                            className="flex min-h-11 w-full items-center gap-2 border-b border-rule px-3 text-left text-[13px] font-medium text-[var(--sg-accent)] transition-colors duration-[120ms] hover:bg-[var(--sg-accent-soft)] pointer-fine:min-h-9"
                          >
                            <Plus className="h-4 w-4" aria-hidden="true" />
                            Adaugă activitate
                          </button>
                        )
                      )}
                    </TableGroup>
                  )
                })}

                {/* Fazele finalizate ascunse își spun numărul, cu butonul care le arată. */}
                {!focusId && <HiddenFinalRow
                  hiddenCount={phases.length - visiblePhases.length}
                  total={phases.length}
                  singular="fază"
                  plural="faze"
                  onReveal={() => {
                    const ids = phases.filter(p => hidden.phases.has(p.id)).map(p => p.id)
                    reveal(...ids)
                    openGroups(...ids)
                  }}
                  focusTargetId={phases.find(p => hidden.phases.has(p.id)) ? `phase-${phases.find(p => hidden.phases.has(p.id))!.id}` : undefined}
                />}

                {/* Documentele trimise clientului: grup separat, cu muchie neutră.
                    Ales din panou, arată doar documentele; „Cereri generale”
                    arată doar cererile (S-20). Un link spre un document trimis
                    duce aici (`isSentDocument`). */}
                {showSentGroup && (!focusId || focusId === SENT_ID) && (
                  <TableGroup
                    id={SENT_ID}
                    title={sentTitle}
                    band={null}
                    icon={<FolderOpen className="h-4 w-4 shrink-0 text-ink-soft" aria-hidden="true" />}
                    collapsed={collapsedGroups.has(SENT_ID)}
                    onToggle={() => toggleGroup(SENT_ID)}
                    meta={isClient ? 'Fișiere trimise de consultant, de citit sau de completat.' : 'Fișiere de citit sau de completat; clientul nu trebuie să răspundă.'}
                    actions={canChange ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => { openGroups(SENT_ID); setSendOpen(true) }}
                        data-tooltip="Trimite clientului fișiere de citit sau de completat — nu așteaptă un răspuns"
                      >
                        <Upload className="h-4 w-4" aria-hidden="true" />
                        Trimite documente
                      </Button>
                    ) : undefined}
                  >
                    <DocumentRequests
                      key="__trimise__"
                      section="sent"
                      sendOpen={sendOpen}
                      onSendOpenChange={setSendOpen}
                      projectId={projectId}
                      activityId={null}
                      activityName={sentTitle}
                      projectMembers={projectMembers}
                      externalRequests={allDocRequests}
                      onRefresh={refreshDocs}
                      clientEmail={project?.profiles?.email ?? null}
                      clientName={project?.profiles?.full_name ?? null}
                      projectTitle={project?.title}
                      readOnly={projectClosed}
                    />
                  </TableGroup>
                )}

                {/* Cererile generale, fără fază și fără activitate: grupul de la
                    coadă, cu muchie neutră — nu e o aripă a proiectului. */}
                {showGeneralGroup && (!focusId || focusId === GENERAL_ID) && (
                  <TableGroup
                    id={GENERAL_ID}
                    title="Cereri generale"
                    band={null}
                    icon={<FolderOpen className="h-4 w-4 shrink-0 text-ink-soft" aria-hidden="true" />}
                    collapsed={collapsedGroups.has(GENERAL_ID)}
                    onToggle={() => toggleGroup(GENERAL_ID)}
                    meta="Cereri de documente care nu țin de o anumită fază."
                    badges={
                      perms.reassign_project ? (
                        <AssigneePicker
                          value={project?.general_consultant_id}
                          person={project?.general_consultant}
                          members={projectMembers}
                          onChange={id => { void handleAssignGeneralConsultant(id) }}
                          label="Atribuie consultant pentru cererile generale"
                          title="Consultant pentru cererile generale"
                          emptyLabel="Neatribuit"
                        />
                      ) : (
                        <span className="text-xs text-ink-soft">
                          {project?.general_consultant ? profileDisplayName(project.general_consultant) : 'Neatribuit'}
                        </span>
                      )
                    }
                  >
                    <div id="general-requests" className="scroll-mt-24 md:scroll-mt-48">
                      <DocumentRequests
                        key="__general__"
                        projectId={projectId}
                        activityId={null}
                        activityName="Cereri generale"
                        generalConsultantId={
                          // Doar dacă e membru — aceeași condiție pe care o pune
                          // serverul; altfel chipul ar arăta publicabil degeaba.
                          projectMembers.some(m => m.id === project?.general_consultant_id)
                            ? project.general_consultant_id
                            : null
                        }
                        projectMembers={projectMembers}
                        externalRequests={allDocRequests}
                        onRefresh={refreshDocs}
                        clientEmail={project?.profiles?.email ?? null}
                        clientName={project?.profiles?.full_name ?? null}
                        projectTitle={project?.title}
                        autoOpenRequestId={autoOpenRequestId}
                        canCloseRequests={perms.complete_items}
                        readOnly={projectClosed}
                        hiddenRequestIds={hidden.requests}
                        onRevealRequests={ids => reveal(...ids)}
                      />
                    </div>
                  </TableGroup>
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      {projectId && (
        <ProjectChatDrawer
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          title="Chat proiect"
          projectId={projectId}
          canModerate={perms.moderate_chat}
          canEditOthers={perms.edit_others_messages}
          readOnly={projectClosed}
          onUnreadCountChange={setUnreadCount}
          searchIndex={searchIndex}
          onNavigate={handleChatNavigate}
        />
      )}

      <UnifiedSearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        index={searchIndex}
        onSelect={handleSearchSelect}
      />

      {selectedDocumentRequest && (
        <DocumentModal
          request={selectedDocumentRequest}
          projectId={projectId!}
          onClose={() => {
            setSelectedDocumentRequestId(null)
            const anchor = pendingRevealAnchor.current
            pendingRevealAnchor.current = null
            if (anchor) revealTarget(anchor)
          }}
          onUpdate={refreshDocs}
          clientEmail={project?.profiles?.email ?? null}
          clientName={project?.profiles?.full_name ?? null}
          projectTitle={project?.title}
          clientVisible={isClientVisibleDocument(selectedDocumentRequest)}
          projectMembers={projectMembers}
          canCloseRequest={perms.complete_items}
          readOnly={projectClosed}
        />
      )}

    </div>
  )
}

export default function ProjectDetailsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-paper" role="status" aria-live="polite">
          <Spinner />
        </div>
      }
    >
      <ProjectDetailsContent />
    </Suspense>
  )
}
