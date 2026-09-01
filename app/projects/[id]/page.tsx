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
  X,
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
import ProjectPhasesSidebar from '@/components/ProjectPhasesSidebar'
import RowActionsMenu from '@/components/RowActionsMenu'
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
import PhaseAccordionSection from '@/components/PhaseAccordionSection'
import ActivityFold from '@/components/ActivityFold'
import ActionNeededPanel from '@/components/ActionNeededPanel'
import PublishStatusControl from '@/components/PublishStatusControl'
import UnifiedSearchDialog from '@/components/UnifiedSearchDialog'
import CalendarSurface from '@/components/calendar/CalendarSurface'
import { buildSearchIndex, type SearchResult } from '@/lib/projectSearch'
import { isClientVisibleActivity, isClientVisibleDocument, isClientVisiblePhase } from '@/lib/client-visibility'
import { publishBlockers } from '@/lib/publish-rules'
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

// Secțiunea distinctă „Cereri generale" (documente fără fază/activitate).
// Aceeași valoare ajunge în `?phase=` din deep-linkurile calendarului.
const GENERAL_ID = GENERAL_PHASE_ID

// Tabul curent. Se reflectă în `?view=`, ca vederea să poată fi trimisă mai
// departe ca link; „phases" e implicitul, deci nu ajunge în URL.
type ProjectView = 'phases' | 'documents' | 'calendar'

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

  const { loading: authLoading, token, apiFetch, profile } = useAuth()
  const { showToast, confirm } = useToast()
  const patchField = usePatchField()

  const [project, setProject] = useState<any>(null)
  const [phases, setPhases] = useState<ProjectPhase[]>([])
  const [allDocRequests, setAllDocRequests] = useState<any[]>([])
  const [selectedDocumentRequestId, setSelectedDocumentRequestId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [documentsError, setDocumentsError] = useState<string | null>(null)
  const [projectMembers, setProjectMembers] = useState<{ id: string; full_name: string | null; email: string }[]>([])
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set())
  const [expandedActivityIds, setExpandedActivityIds] = useState<Set<string>>(new Set())
  const [activePhaseId, setActivePhaseId] = useState<string | null>(null)
  const [highlightActivityId, setHighlightActivityId] = useState<string | null>(null)
  const [highlightGeneralRequests, setHighlightGeneralRequests] = useState(false)

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
  const [landingView, setLandingView] = useState<'action-needed' | 'browse'>(hasDeepLink ? 'browse' : 'action-needed')
  const [landingViewInitialized, setLandingViewInitialized] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [autoOpenRequestId, setAutoOpenRequestId] = useState<string | null>(null)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  // Două momente distincte din viața aceluiași deep-link: `appliedDeepLink` —
  // tabul și faza au fost mutate; `handledDeepLink` — s-a derulat până la
  // element. Al doilea îl așteaptă pe primul și pe randare, deci nu pot fi unul.
  const appliedDeepLink = useRef<string | null>(null)
  const handledDeepLink = useRef<string | null>(null)

  const [showAddActivity, setShowAddActivity] = useState<Record<string, boolean>>({})
  const [newActivityName, setNewActivityName] = useState<Record<string, string>>({})
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
  }, [phases, allDocRequests, profile?.role, profile?.id, project?.general_consultant_id, projectMembers])
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
      setProject((await projRes.json()).project)

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
  const [renamingId, setRenamingId] = useState<string | null>(null)
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
    setDuplicatingId(phaseId)
    try {
      const res = await apiFetch(`/api/projects/${projectId}/phases/${phaseId}/duplicate`, { method: 'POST' })
      if (!res.ok) { showToast('Nu am putut duplica faza. Reîncearcă.', 'error'); return }
      const { phase: copy } = await res.json()
      await Promise.all([refreshPhases(), refreshDocs()])
      if (copy?.id) {
        setExpandedPhases(prev => new Set(prev).add(copy.id))
        setRenamingId(copy.id)
      }
      showToast(`Faza „${phaseName}” a fost duplicată. Copia este în pregătire.`, 'success')
    } catch {
      showToast('Nu am putut duplica faza. Reîncearcă.', 'error')
    } finally { setDuplicatingId(null) }
  }

  const handleDuplicateActivity = async (phaseId: string, activityId: string, activityName: string) => {
    if (duplicatingId) return
    setDuplicatingId(activityId)
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/phases/${phaseId}/activities/${activityId}/duplicate`,
        { method: 'POST' },
      )
      if (!res.ok) { showToast('Nu am putut duplica activitatea. Reîncearcă.', 'error'); return }
      const { activity: copy } = await res.json()
      await Promise.all([refreshPhases(), refreshDocs()])
      if (copy?.id) setRenamingId(copy.id)
      showToast(`Activitatea „${activityName}” a fost duplicată. Copia este în pregătire.`, 'success')
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

  const handleSaveTitle = async () => {
    if (!editTitle.trim() || editTitle === project?.title) { setIsEditingTitle(false); return }
    setSaving(true)
    try {
      const res = await apiFetch(`/api/projects/${projectId}`, {
        method: 'PATCH', body: JSON.stringify({ title: editTitle.trim() })
      })
      const data = await res.json().catch(() => null)
      if (res.ok) { setProject(data.project); setIsEditingTitle(false) }
      else showToast('Nu am putut salva proiectul. Reîncearcă.', 'error')
    } finally { setSaving(false) }
  }

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

  const handleAddActivity = async (phaseId: string) => {
    const name = (newActivityName[phaseId] || '').trim()
    if (!name) return
    setAddingActivity(prev => ({ ...prev, [phaseId]: true }))
    try {
      const res = await apiFetch(`/api/projects/${projectId}/phases/${phaseId}/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (res.ok) {
        setShowAddActivity(prev => ({ ...prev, [phaseId]: false }))
        setNewActivityName(prev => ({ ...prev, [phaseId]: '' }))
        fetchAll()
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
    setExpandedPhases(prev => {
      const next = new Set(prev)
      if (next.has(phaseId)) next.delete(phaseId)
      else next.add(phaseId)
      return next
    })
  }

  // Selectarea unei faze din sidebar o marchează ca țintă, o depliază și
  // închide restul — accordion exclusiv.
  const scrollToPhaseSection = (id: string) => {
    setTimeout(() => {
      document.getElementById(`phase-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 120)
  }

  const handleSelectPhase = (phaseId: string) => {
    selectView('phases')
    setLandingView('browse')
    setActivePhaseId(phaseId)
    setExpandedPhases(new Set([phaseId]))
    setMobileSidebarOpen(false)
    scrollToPhaseSection(phaseId)
  }

  const handleSelectGeneral = () => {
    selectView('phases')
    setLandingView('browse')
    setActivePhaseId(GENERAL_ID)
    setExpandedPhases(new Set([GENERAL_ID]))
    setMobileSidebarOpen(false)
    scrollToPhaseSection(GENERAL_ID)
  }

  const allPhasesExpanded =
    phases.length > 0 &&
    phases.every(p => expandedPhases.has(p.id)) &&
    expandedPhases.has(GENERAL_ID)

  const handleToggleAllPhases = () => {
    if (allPhasesExpanded) {
      setExpandedPhases(new Set())
    } else {
      setExpandedPhases(new Set([...phases.map(p => p.id), GENERAL_ID]))
    }
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
    setActiveView('phases')
    setLandingView('browse')
    setActivePhaseId(targetPhaseId)
    setExpandedPhases(prev => (prev.has(targetPhaseId) ? prev : new Set(prev).add(targetPhaseId)))
  }, [targetPhaseId, targetActivityId, targetDocumentId, phases])

  // ─── Deep-link: scroll + highlight zona țintă din URL ───────────────────────
  useEffect(() => {
    const deepLinkKey = `${targetPhaseId}:${targetActivityId}:${targetDocumentId}`
    if (!targetPhaseId) {
      handledDeepLink.current = null
      return
    }
    if (handledDeepLink.current === deepLinkKey) return
    if (loading || activePhaseId !== targetPhaseId) return
    const anchor = targetActivityId
      ? `activity-${targetActivityId}`
      : targetPhaseId === GENERAL_ID ? 'general-requests' : null
    if (!anchor) return

    if (targetActivityId) setExpandedActivityIds(prev => new Set(prev).add(targetActivityId))
    const timer = setTimeout(() => {
      const el = document.getElementById(anchor)
      if (!el) return
      handledDeepLink.current = deepLinkKey
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      if (targetActivityId) {
        setHighlightActivityId(targetActivityId)
        setTimeout(() => setHighlightActivityId(null), 2500)
        if (targetDocumentId) {
          setSelectedDocumentRequestId(targetDocumentId)
        }
      } else {
        setHighlightGeneralRequests(true)
        setTimeout(() => setHighlightGeneralRequests(false), 2500)
        if (targetDocumentId) {
          setSelectedDocumentRequestId(targetDocumentId)
        }
      }
    }, 250)
    return () => clearTimeout(timer)
  }, [loading, targetActivityId, targetPhaseId, targetDocumentId, activePhaseId])

  // Sari direct la o activitate (din panoul "Ce e de făcut"), fără reload.
  // Cu requestId, deschide direct fișa cererii — zero click-uri suplimentare
  // pentru client între "ce am de făcut" și zona de încărcare.
  const jumpToActivity = (phaseId: string | null, activityId: string | null, requestId?: string) => {
    selectView('phases')
    setLandingView('browse')
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
    setTimeout(() => {
      const anchor = activityId ? `activity-${activityId}` : 'general-requests'
      const el = document.getElementById(anchor)
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      if (activityId) {
        setHighlightActivityId(activityId)
        setTimeout(() => setHighlightActivityId(null), 2500)
      } else {
        setHighlightGeneralRequests(true)
        setTimeout(() => setHighlightGeneralRequests(false), 2500)
      }
    }, 120)
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
      waitingOnClient: isClient ? [] : incoming.filter((r: any) => r.status === 'pending').map(toPanelItem).sort(byDeadline),
    }
  }, [allDocRequests, phaseNameById, isClient])
  const actionNeededCount = pendingUploads.length + waitingOnClient.length

  // Fără params deschidem mereu "Ce ai de făcut"; params expliciți duc la browse.
  useEffect(() => {
    if (loading || landingViewInitialized) return
    setLandingView(hasDeepLink ? 'browse' : 'action-needed')
    setLandingViewInitialized(true)
  }, [loading, landingViewInitialized, hasDeepLink])

  const searchIndex = useMemo(() => buildSearchIndex(phases, allDocRequests), [phases, allDocRequests])

  const handleSearchSelect = (result: SearchResult) => {
    if (result.type === 'phase') {
      selectView('phases')
      setLandingView('browse')
      setExpandedPhases(new Set([result.id]))
      setTimeout(() => {
        document.getElementById(`phase-${result.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 120)
      return
    }
    if (result.type === 'activity') {
      jumpToActivity(result.phaseId, result.activityId)
      return
    }
    // document_request — deschide și fișa cererii, odată ce faza/activitatea e vizibilă
    jumpToActivity(result.phaseId, result.activityId, result.id)
  }

  // ─── Loading / error ──────────────────────────────────────────────────────

  if (authLoading || loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin" />
          <p className="text-sm text-slate-500">Se încarcă...</p>
        </div>
      </div>
    )
  }

  // `projectId` intră în gardă alături de proiect, ca restul paginii să-l poată
  // folosi ca `string`. Fără el, `CalendarSurface` ar fi căzut pe calendarul
  // general și ar fi arătat, în pagina unui proiect, termenele tuturor.
  if (!project || !projectId) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Proiect negăsit</h2>
          <button onClick={() => router.push('/')}
            className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium inline-flex items-center gap-2">
            <ArrowLeft className="w-4 h-4" /> Înapoi
          </button>
        </div>
      </div>
    )
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="project-scope min-h-screen flex flex-col bg-[var(--p-bg)] text-[var(--p-ink)] w-screen ml-[calc(50%-50vw)] mr-[calc(50%-50vw)]">

      {/* ── Top bar ── */}
      <header className="bg-[var(--p-surface)] border-b border-[var(--p-border)] sticky top-0 z-20">
        <div className="px-4 sm:px-6 h-14 flex items-center gap-3">
          <button onClick={() => router.push('/')}
            className="flex items-center gap-1.5 text-sm text-[var(--p-ink-soft)] hover:text-[var(--p-ink)] transition-colors flex-shrink-0">
            <ArrowLeft className="w-4 h-4" />
            <span className="font-medium hidden sm:block">Proiecte</span>
          </button>
          <span className="text-[var(--p-border-strong)] hidden sm:block">/</span>

          {/* Editable title */}
          {isEditingTitle ? (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <input
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSaveTitle(); if (e.key === 'Escape') setIsEditingTitle(false) }}
                autoFocus disabled={saving}
                className="flex-1 text-sm font-semibold text-slate-900 bg-transparent border-b border-indigo-500 focus:outline-none py-0.5 min-w-0"
              />
              <button onClick={handleSaveTitle} disabled={saving}
                className="p-1 rounded bg-emerald-100 text-emerald-600 flex-shrink-0">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              </button>
              <button onClick={() => setIsEditingTitle(false)}
                className="p-1 rounded bg-slate-100 text-slate-500 flex-shrink-0">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <h1 className="font-display text-base font-semibold text-[var(--p-ink)] truncate">{project.title}</h1>
              {isAdmin && (
                <button onClick={() => { setEditTitle(project.title); setIsEditingTitle(true) }}
                  className="p-1 rounded text-slate-300 hover:text-slate-600 hover:bg-slate-100 flex-shrink-0">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          {/* Meta pills */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => setMobileSidebarOpen(true)}
              title="Faze proiect"
              aria-label="Deschide fazele proiectului"
              className="md:hidden inline-flex items-center justify-center w-7 h-7 rounded-full text-[var(--p-ink-soft)] bg-[var(--p-surface)] border border-[var(--p-border-strong)] hover:bg-[var(--p-surface-2)]"
            >
              <Layers className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={() => setSearchOpen(true)}
              title="Caută în proiect"
              className="inline-flex items-center justify-center w-7 h-7 rounded-full text-[var(--p-ink-soft)] bg-[var(--p-surface)] border border-[var(--p-border-strong)] hover:bg-[var(--p-surface-2)]"
            >
              <Search className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={handleOpenChat}
              className="relative inline-flex items-center gap-1.5 text-xs font-medium text-[var(--p-ink-soft)] bg-[var(--p-surface)] border border-[var(--p-border-strong)] px-2.5 py-1 rounded-full hover:bg-[var(--p-surface-2)]"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              Chat
              {unreadCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-rose-500 text-white text-[10px] font-bold shadow">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>

            {canEdit && (
              <button
                onClick={handleNotifyClient}
                disabled={!hasUnnotifiedUpdates || notifyingClient}
                title={hasUnnotifiedUpdates ? 'Anunță clientul despre actualizări: noutăți publicate și documente verificate' : 'Nicio actualizare de anunțat'}
                className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border transition-colors ${
                  hasUnnotifiedUpdates
                    ? 'text-white bg-[var(--p-accent)] border-transparent hover:opacity-90'
                    : 'text-[var(--p-ink-faint)] bg-[var(--p-surface)] border-[var(--p-border-strong)] opacity-60 cursor-not-allowed'
                } disabled:cursor-not-allowed`}
              >
                {notifyingClient ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Megaphone className="w-3.5 h-3.5" />}
                <span className="hidden sm:block">Anunță clientul</span>
              </button>
            )}

            {/* Pornite, e doar o iconiță ca celelalte; oprite, se face pastilă
                galbenă cu text. Starea neobișnuită e cea care merită spațiu —
                altfel butonul ar striga pe fiecare proiect în care totul e
                normal. Iconița arată starea, titlul spune ce face apăsarea. */}
            {isAdmin && (
              <button
                onClick={handleToggleAutomaticReminders}
                disabled={togglingReminders}
                title={
                  automaticRemindersEnabled(project)
                    ? 'Reminderele automate sunt pornite. Apasă ca să le oprești.'
                    : 'Reminderele automate sunt oprite. Apasă ca să le pornești.'
                }
                aria-label={remindersActionLabel(automaticRemindersEnabled(project))}
                className={`inline-flex items-center gap-1.5 rounded-full border text-xs font-medium transition-colors disabled:opacity-60 ${
                  automaticRemindersEnabled(project)
                    ? 'w-7 h-7 justify-center text-[var(--p-ink-soft)] bg-[var(--p-surface)] border-[var(--p-border-strong)] hover:bg-[var(--p-surface-2)]'
                    : 'px-2.5 py-1 text-amber-700 bg-amber-50 border-amber-200 hover:bg-amber-100'
                }`}
              >
                {togglingReminders
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : automaticRemindersEnabled(project)
                    ? <Bell className="w-3.5 h-3.5" />
                    : <BellOff className="w-3.5 h-3.5" />}
                {!automaticRemindersEnabled(project) && (
                  <span className="hidden sm:block">Remindere oprite</span>
                )}
              </button>
            )}

            <span className="hidden sm:flex items-center gap-1.5 text-xs text-[var(--p-ink-soft)] bg-[var(--p-surface-2)] px-2.5 py-1 rounded-full">
              <Building2 className="w-3.5 h-3.5" />
              {project.profiles?.full_name || 'Client'}
            </span>
          </div>
        </div>
      </header>

      {/* ── Body: sidebar + main ── */}
      <div className="flex flex-1 w-full px-4 sm:px-6">

        {/* ══ SIDEBAR — ascuns în vederile Documente și Calendar ══ */}
        {activeView === 'phases' && (
          <ProjectPhasesSidebar
            phases={phases}
            activePhaseId={landingView === 'browse' ? activePhaseId : null}
            expandedPhases={expandedPhases}
            canEdit={canEdit}
            projectId={projectId}
            documentRequests={allDocRequests}
            isGeneralActive={landingView === 'browse' && activePhaseId === GENERAL_ID}
            onSelectPhase={handleSelectPhase}
            onSelectGeneral={handleSelectGeneral}
            onToggleExpand={handleToggleExpand}
            onRefresh={fetchAll}
            onReorderRefresh={refreshPhases}
            onTeamChange={fetchProjectMembers}
            apiFetch={apiFetch}
            isAdmin={isAdmin}
            mobileOpen={mobileSidebarOpen}
            onMobileClose={() => setMobileSidebarOpen(false)}
          />
        )}

        {/* ══ MAIN ══ */}
        <main className="flex-1 min-w-0">

          {/* ── Tab switcher ── */}
          <div className="sticky top-14 z-10 h-12 bg-[var(--p-surface)] border-b border-[var(--p-border)] px-4 sm:px-6">
            <div className="flex h-full gap-1 -mb-px overflow-x-auto">
              {([
                { view: 'phases', label: 'Faze & Activități', Icon: Layers, count: 0, urgent: false, hint: '' },
                {
                  view: 'documents',
                  label: 'Documente',
                  Icon: FolderOpen,
                  count: documentEntriesCount,
                  urgent: false,
                  hint: `${documentEntriesCount} fișiere`,
                },
                {
                  view: 'calendar',
                  label: 'Calendar',
                  Icon: CalendarDays,
                  count: calendarUrgentCount,
                  urgent: true,
                  hint: `${calendarUrgentCount} termene depășite sau în următoarele 7 zile`,
                },
              ] as const).map(({ view, label, Icon, count, urgent, hint }) => (
                <button
                  key={view}
                  onClick={() => selectView(view)}
                  aria-current={activeView === view ? 'page' : undefined}
                  className={`flex h-full items-center gap-2 px-4 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                    activeView === view
                      ? 'border-indigo-600 text-indigo-600'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
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
                        className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                          urgent ? 'bg-[var(--p-danger-soft)] text-[var(--p-danger)]' : 'bg-slate-100 text-slate-600'
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
          </div>

          {/* ── Content ── */}
          {activeView === 'calendar' ? (
            <div className="p-4 sm:p-6 max-w-5xl mx-auto">
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
          ) : (
            <>
              <div className="flex items-center gap-2 px-4 sm:px-6 pt-4">
                <button
                  onClick={() => setLandingView('action-needed')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                    landingView === 'action-needed'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  Ce ai de făcut
                  {actionNeededCount > 0 && (
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                      landingView === 'action-needed' ? 'bg-white/20' : 'bg-white'
                    }`}>
                      {actionNeededCount}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setLandingView('browse')}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                    landingView === 'browse'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  Fazele proiectului
                </button>
              </div>

              {landingView === 'action-needed' ? (
                <ActionNeededPanel items={pendingUploads} waitingItems={waitingOnClient} isClient={isClient} onJump={jumpToActivity} />
              ) : phases.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-8">
              <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-4">
                <Layers className="w-8 h-8 text-slate-400" />
              </div>
              <h2 className="text-lg font-semibold text-slate-900 mb-1">Niciun template importat</h2>
              <p className="text-sm text-slate-500 max-w-xs">
                Importați un template de proiect pentru a vedea fazele și cererile de documente organizate pe activități.
              </p>
            </div>
          ) : (
            <div className="p-4 sm:p-8 space-y-5 max-w-5xl mx-auto">
              <div className="flex items-center justify-between gap-3 mb-1">
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Faze &amp; Activități</h2>
                <button
                  onClick={handleToggleAllPhases}
                  className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 flex-shrink-0"
                >
                  {allPhasesExpanded ? 'Restrânge toate fazele' : 'Extinde toate fazele'}
                </button>
              </div>

              {phases.filter(phase => expandedPhases.has(phase.id)).map(phase => (
                <PhaseAccordionSection
                  key={phase.id}
                  id={phase.id}
                  title={phase.name}
                  subtitle={`${phase.activities?.length ?? 0} activit${phase.activities?.length === 1 ? 'ate' : 'ăți'}`}
                  color={phase.visibility === 'published' ? 'var(--p-success)' : 'var(--p-warning)'}
                  headerRight={
                    <div className="flex items-center gap-2.5">
                      <PublishStatusControl
                        status={phase.visibility ?? 'draft'}
                        canPublish={canEdit}
                        onPublish={() => publishProjectItem(`/api/projects/${projectId}/phases/${phase.id}`, {
                          title: 'Publică faza?',
                          description: 'Faza va deveni vizibilă clientului. Activitățile și cererile deja publicate din această fază vor deveni vizibile.',
                        })}
                      />
                    </div>
                  }
                  actions={canEdit ? (
                    <RowActionsMenu
                      label={`Acțiuni pentru faza ${phase.name}`}
                      busy={duplicatingId === phase.id || deletingId === phase.id}
                      actions={[
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
                          hidden: !isAdmin,
                          onSelect: () => { void askToDeletePhase(phase) },
                        },
                      ]}
                    />
                  ) : undefined}
                  renaming={renamingId === phase.id}
                  renameLoading={savingRename === phase.id}
                  onRenameSubmit={name => { void renameItem(`/api/projects/${projectId}/phases/${phase.id}`, phase.id, name) }}
                  onRenameCancel={() => setRenamingId(null)}
                  open={expandedPhases.has(phase.id)}
                  onOpenChange={() => handleToggleExpand(phase.id)}
                >
                  {(phase.activities?.length ?? 0) === 0 && !canEdit ? (
                    <p className="text-sm text-[var(--p-ink-faint)]">Nicio activitate în această fază.</p>
                  ) : (
                    <>
                    {phase.activities?.map(activity => (
                      <ActivityFold
                        key={activity.id}
                        activity={activity}
                        requestCount={allDocRequests.filter((r: any) => !r.is_outgoing && r.activity_id === activity.id).length}
                        open={expandedActivityIds.has(activity.id)}
                        onOpenChange={() => handleToggleActivity(activity.id)}
                        highlighted={highlightActivityId === activity.id}
                        canAssign={canEdit}
                        projectMembers={projectMembers}
                        onAssign={assignedTo => { handleAssignActivity(phase.id, activity.id, assignedTo).catch(() => {}) }}
                        visibility={activity.visibility}
                        canPublish={canEdit}
                        publishBlockers={publishBlockers({
                          kind: 'activity',
                          currentDeadline: activity.deadline_at,
                          currentAssignee: activity.assigned_to,
                        })}
                        onSetDeadline={date => saveActivityDeadline(phase.id, activity.id, date)}
                        actions={canEdit ? (
                          <RowActionsMenu
                            label={`Acțiuni pentru activitatea ${activity.name}`}
                            busy={duplicatingId === activity.id || deletingId === activity.id}
                            actions={[
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
                                hidden: !isAdmin,
                                onSelect: () => { void askToDeleteActivity(phase, activity) },
                              },
                            ]}
                          />
                        ) : undefined}
                        renaming={renamingId === activity.id}
                        renameLoading={savingRename === activity.id}
                        onRenameSubmit={name => { void renameItem(`/api/projects/${projectId}/phases/${phase.id}/activities/${activity.id}`, activity.id, name) }}
                        onRenameCancel={() => setRenamingId(null)}
                        onPublish={() => publishProjectItem(`/api/projects/${projectId}/phases/${phase.id}/activities/${activity.id}`, {
                          title: 'Publică activitatea?',
                          description: phase.visibility === 'published'
                            ? 'Activitatea va deveni vizibilă clientului.'
                            : `Activitatea va fi publicată, dar clientul o va vedea doar după ce publici faza „${phase.name}”.`,
                        })}
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
                        />
                      </ActivityFold>
                    ))}
                    {canEdit && (
                      showAddActivity[phase.id] ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            autoFocus
                            value={newActivityName[phase.id] || ''}
                            onChange={e => setNewActivityName(prev => ({ ...prev, [phase.id]: e.target.value }))}
                            onKeyDown={e => {
                              if (e.key === 'Enter') handleAddActivity(phase.id)
                              if (e.key === 'Escape') setShowAddActivity(prev => ({ ...prev, [phase.id]: false }))
                            }}
                            placeholder="Nume activitate..."
                            disabled={!!addingActivity[phase.id]}
                            className="flex-1 text-sm px-3 py-2 rounded-lg border border-[var(--p-border-strong)] bg-[var(--p-surface)] text-[var(--p-ink)] outline-none focus:ring-2 focus:ring-[var(--p-accent)]/20 focus:border-[var(--p-accent)]"
                          />
                          <button
                            onClick={() => handleAddActivity(phase.id)}
                            disabled={!!addingActivity[phase.id] || !(newActivityName[phase.id] || '').trim()}
                            className="p-2 rounded-lg bg-[var(--p-success-soft)] text-[var(--p-success)] hover:opacity-80 disabled:opacity-40 flex-shrink-0"
                          >
                            {addingActivity[phase.id] ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                          </button>
                          <button
                            onClick={() => setShowAddActivity(prev => ({ ...prev, [phase.id]: false }))}
                            className="p-2 rounded-lg bg-[var(--p-surface-2)] text-[var(--p-ink-soft)] hover:opacity-80 flex-shrink-0"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setShowAddActivity(prev => ({ ...prev, [phase.id]: true }))}
                          className="flex items-center gap-1.5 text-sm font-medium text-[var(--p-accent)] hover:opacity-80 transition-opacity"
                        >
                          <Plus className="w-4 h-4" />
                          Adaugă activitate
                        </button>
                      )
                    )}
                    </>
                  )}
                </PhaseAccordionSection>
              ))}

              {/* ── Secțiune distinctă: Cereri generale (fără fază/activitate) ── */}
              {expandedPhases.has(GENERAL_ID) && (
                <PhaseAccordionSection
                  id={GENERAL_ID}
                  title="Cereri generale"
                  subtitle="Documente care nu țin de o anumită fază a proiectului."
                  icon={<FolderOpen className="w-4 h-4 text-indigo-500 flex-shrink-0" />}
                  headerRight={
                    isAdmin ? (
                      <select
                        value={project?.general_consultant_id ?? ''}
                        onClick={e => e.stopPropagation()}
                        onChange={e => handleAssignGeneralConsultant(e.target.value || null)}
                        aria-label="Atribuie consultant pentru cererile generale"
                        className="max-w-40 text-xs border border-slate-200 rounded-md px-1.5 py-1 text-slate-700 bg-white"
                      >
                        <option value="">Neatribuit</option>
                        {projectMembers.map(m => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}
                      </select>
                    ) : (
                      <span className="text-xs text-slate-500">
                        {project?.general_consultant?.full_name ?? project?.general_consultant?.email ?? 'Neatribuit'}
                      </span>
                    )
                  }
                  open={expandedPhases.has(GENERAL_ID)}
                  onOpenChange={() => handleToggleExpand(GENERAL_ID)}
                >
                  <div
                    id="general-requests"
                    className={`scroll-mt-24 rounded-xl transition-shadow ${highlightGeneralRequests ? 'ring-2 ring-[var(--p-accent)] ring-offset-2 ring-offset-[var(--p-bg)]' : ''}`}
                  >
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
                    />
                  </div>
                </PhaseAccordionSection>
              )}
            </div>
          )}
            </>
          )}
        </main>
      </div>

      {projectId && (
        <ProjectChatDrawer
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          title="Chat proiect"
          projectId={projectId}
          onUnreadCountChange={setUnreadCount}
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
          onClose={() => setSelectedDocumentRequestId(null)}
          onUpdate={refreshDocs}
          clientEmail={project?.profiles?.email ?? null}
          clientName={project?.profiles?.full_name ?? null}
          projectTitle={project?.title}
          clientVisible={isClientVisibleDocument(selectedDocumentRequest)}
          projectMembers={projectMembers}
        />
      )}

    </div>
  )
}

export default function ProjectDetailsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-slate-50">
          <div className="w-10 h-10 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin" />
        </div>
      }
    >
      <ProjectDetailsContent />
    </Suspense>
  )
}
