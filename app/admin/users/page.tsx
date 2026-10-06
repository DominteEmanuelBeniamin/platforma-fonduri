/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import * as Dialog from '@radix-ui/react-dialog'
import { UserPlus, Trash2, X, Loader2, ChevronRight, Power, RotateCcw } from 'lucide-react'
import { useAuth } from '@/app/providers/AuthProvider'
import ConfirmDeleteModal from '@/components/ConfirmDeleteModal'
import { FeedbackMessage } from '@/components/FeedbackMessage'
import { useToast } from '@/app/providers/ToastProvider'
import { LocationStrip } from '@/components/ui/LocationStrip'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { SearchInput } from '@/components/ui/SearchInput'
import { EmptyState } from '@/components/ui/EmptyState'
import { Plate } from '@/components/ui/Plate'
import { FloatingSurface, Scrim } from '@/components/ui/Surface'
import { formatDate } from '@/lib/signage'
import { Spinner } from '@/components/ui/Spinner'
import { Signal } from '@/components/ui/Signal'
import { profileDisplayName } from '@/lib/profile-display'

type Rol = 'admin' | 'consultant' | 'client'
type UserState = 'active' | 'inactive' | 'all'
type LifecycleImpact = {
  activities: number
  documentRequests: number
  activeProjects: number
  completedProjects: number
  generalConsultantProjects: number
  projectsWithoutActiveSenior: number
}

function lifecycleCodeMessage(code?: string) {
  if (code === 'SELF_ACCOUNT_ACTION') return 'Nu poți dezactiva sau șterge propriul cont.'
  if (code === 'LAST_ACTIVE_ADMIN') return 'Trebuie să rămână cel puțin un administrator activ.'
  if (code === 'USER_HAS_RELATED_DATA') return 'Contul are date asociate și nu poate fi șters.'
  if (code === 'AUTH_SYNC_INCOMPLETE') return 'Accesul contului este blocat, dar dezactivarea trebuie reîncercată.'
  return 'Nu am putut finaliza acțiunea. Reîncearcă.'
}

const BLOCKER_TABLE_LABELS: Record<string, string> = {
  profiles: 'Profiluri',
  projects: 'Proiecte',
  project_members: 'Membri ai proiectelor',
  project_phases: 'Faze de proiect',
  project_activities: 'Activități',
  document_requests: 'Cereri de documente',
  document_requirements: 'Cerințe de documente',
  activity_document_requirements: 'Documente de activitate',
  activity_document_files: 'Fișiere de activitate',
  template_document_requirements: 'Documente din șabloane',
  template_phases: 'Faze din șabloane',
  document_request_reviews: 'Evaluări de documente',
  document_requirement_attachments: 'Fișiere de documente',
  document_upload_batches: 'Loturi de încărcare',
  templates: 'Șabloane',
  project_templates: 'Șabloane de proiect',
  template_activities: 'Activități din șabloane',
  project_chat_messages: 'Mesaje din chatul proiectului',
  project_chat_events: 'Evenimente din chatul proiectului',
  project_chat_reads: 'Marcări de citire în chatul proiectului',
  private_conversations: 'Conversații private',
  private_conversation_participants: 'Participanți la conversații private',
  private_messages: 'Mesaje private',
  private_message_reads: 'Marcări de citire private',
  notifications: 'Notificări',
  deadline_reminders: 'Mementouri de termen',
  reminder_log: 'Istoricul mementourilor',
  audit_logs: 'Acțiuni în jurnalul de audit',
}

function blockerLabel(kind: string) {
  if (kind === 'storage.objects.owner' || kind === 'storage.objects.owner_id' || kind === 'storage.objects.owner/owner_id') return 'Fișiere din stocare'
  const qualifiedKind = kind.startsWith('public.') ? kind.slice('public.'.length) : kind
  const table = qualifiedKind.split('.')[0]
  return BLOCKER_TABLE_LABELS[table] || 'Alte date asociate'
}

/** Rolul e o identitate, nu o stare. Nu primește culoare de semnal — verdele,
 *  chihlimbarul și roșul rămân rezervate pentru ce se întâmplă cu munca. */
const ROLURI: Record<Rol, string> = {
  client: 'Client (firmă)',
  consultant: 'Consultant',
  admin: 'Administrator',
}

/** Câmpul de formular: etichetă, ajutor vizibil și input. Ajutorul stă sub
 *  câmp, nu într-un tooltip care apare la hover — un indiciu pe care nu-l vezi
 *  cu tastatura și nu-l atingi cu degetul nu e ajutor. */
function Camp({
  label, required, hint, children,
}: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-ink">
        {label}{required && <span className="ml-0.5 text-[var(--sg-danger)]" aria-hidden="true">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-soft">{hint}</span>}
    </label>
  )
}

const inputClass =
  'h-11 w-full rounded-[var(--radius-plate)] border border-rule bg-plate px-3 text-sm text-ink ' +
  'placeholder:text-ink-faint transition-colors duration-[120ms] focus:border-[var(--sg-accent)] sm:h-10'

export default function AdminUsersPage() {
  const router = useRouter()
  const { loading: authLoading, token, apiFetch, profile } = useAuth()
  const { showToast, confirm } = useToast()

  const [users, setUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [updatingRoleId, setUpdatingRoleId] = useState<string | null>(null)

  // Căutare și filtrare — pagina e despre utilizatorii care există deja.
  const [cauta, setCauta] = useState('')
  const [filtruRol, setFiltruRol] = useState<Rol | 'toate'>('toate')
  const [filtruStare, setFiltruStare] = useState<UserState>('active')

  // Formularul stă într-un panou, nu peste listă.
  const [panouDeschis, setPanouDeschis] = useState(false)
  const [newRole, setNewRole] = useState<Rol>('client')
  const [newEmail, setNewEmail] = useState('')
  const [newName, setNewName] = useState('')
  const [fallbackCredentials, setFallbackCredentials] = useState<{ email: string; password: string } | null>(null)
  const [partialCreationUserId, setPartialCreationUserId] = useState<string | null>(null)
  const [telefon, setTelefon] = useState('')
  const [cif, setCif] = useState('')
  const [numeFirma, setNumeFirma] = useState('')
  const [adresaFirma, setAdresaFirma] = useState('')
  const [persoanaContact, setPersoanaContact] = useState('')
  const [specializare, setSpecializare] = useState('')
  const [departament, setDepartament] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [userToDelete, setUserToDelete] = useState<{ id: string; email: string; is_active: boolean } | null>(null)
  const [checkingDelete, setCheckingDelete] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleteBlockers, setDeleteBlockers] = useState<Array<{ kind: string; count: number }>>([])
  const [deleteHasRelatedData, setDeleteHasRelatedData] = useState(false)
  const [impactUser, setImpactUser] = useState<any | null>(null)
  const [impact, setImpact] = useState<LifecycleImpact | null>(null)
  const [impactBlockers, setImpactBlockers] = useState<Array<{ kind: string; count: number }>>([])
  const [loadingImpact, setLoadingImpact] = useState(false)
  const [impactUnavailable, setImpactUnavailable] = useState(false)
  const [lifecycleActionError, setLifecycleActionError] = useState<string | null>(null)
  const [changingStateId, setChangingStateId] = useState<string | null>(null)
  const lifecycleFocusReturnRef = useRef<HTMLElement | null>(null)

  const clearCreateForm = () => {
    setNewEmail(''); setNewName(''); setTelefon('')
    setCif(''); setNumeFirma(''); setAdresaFirma(''); setPersoanaContact('')
    setSpecializare(''); setDepartament('')
  }

  const closeCreatePanel = useCallback(() => {
    if (isCreating) return
    setFallbackCredentials(null)
    setPartialCreationUserId(null)
    setPanouDeschis(false)
  }, [isCreating])

  const openCreatePanel = useCallback(() => {
    setFallbackCredentials(null)
    setPartialCreationUserId(null)
    setPanouDeschis(true)
  }, [])

  const fetchUsers = useCallback(async (showLoader = true) => {
    try {
      if (showLoader) setLoading(true)
      const res = await apiFetch('/api/users?state=' + filtruStare)
      if (!res.ok) { showToast('Nu am putut încărca utilizatorii. Reîncearcă.', 'error'); return }
      const { users: data } = await res.json()
      setUsers(data)
    } finally {
      if (showLoader) setLoading(false)
    }
  }, [apiFetch, showToast, filtruStare])

  useEffect(() => {
    if (authLoading) return
    if (!token) { router.replace('/login'); return }
    if (!profile) return
    if (profile.role !== 'admin') { router.replace('/'); return }
    fetchUsers()
  }, [authLoading, token, profile, router, fetchUsers])

  useEffect(() => {
    setCif(''); setNumeFirma(''); setAdresaFirma(''); setPersoanaContact('')
    setSpecializare(''); setDepartament('')
  }, [newRole])

  useEffect(() => {
    if (!panouDeschis) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeCreatePanel() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [panouDeschis, closeCreatePanel])

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault()
    setFallbackCredentials(null)
    setPartialCreationUserId(null)
    setIsCreating(true)
    try {
      const payload: any = { email: newEmail, role: newRole, fullName: newName, telefon: telefon || null }
      if (newRole === 'client') { payload.cif = cif || null; payload.numeFirma = numeFirma || null; payload.adresaFirma = adresaFirma || null; payload.persoanaContact = persoanaContact || null }
      else if (newRole === 'consultant') { payload.specializare = specializare || null; payload.departament = departament || null }
      else if (newRole === 'admin') { payload.departament = departament || null }

      const res = await apiFetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (!res.ok) {
        const error = await res.json().catch(() => null) as { code?: string; userId?: string } | null
        if (error?.code === 'profile_update_failed' && typeof error.userId === 'string') {
          clearCreateForm()
          setPartialCreationUserId(error.userId)
          return
        }
        throw new Error()
      }

      const result: { userId: string; emailSent: true } | { userId: string; emailSent: false; temporaryPassword: string } = await res.json()
      clearCreateForm()
      if (result.emailSent) {
        showToast('Utilizatorul a fost creat.', 'success')
        setFallbackCredentials(null)
        setPartialCreationUserId(null)
        setPanouDeschis(false)
        fetchUsers()
      } else {
        setFallbackCredentials({ email: newEmail.trim(), password: result.temporaryPassword })
        fetchUsers(false)
      }
    } catch {
      showToast('Nu am putut crea utilizatorul. Verifică datele și reîncearcă.', 'error')
    } finally {
      setIsCreating(false)
    }
  }

  const updateUserRole = async (user: { id: string; email: string; full_name?: string | null; is_active?: boolean | null; role?: string }, rolNou: string) => {
    const rolVechi = ROLURI[(user.role as Rol) || 'client']
    // Descrierea numește persoana și direcția schimbării — un admin care
    // derulează rapid prin listă trebuie să vadă exact ce confirmă, nu o
    // propoziție generică pe care o apasă din reflex.
    if (!await confirm({
      title: 'Confirmă schimbarea rolului',
      description: `Rolul lui ${profileDisplayName(user, user.full_name || user.email)} se schimbă din „${rolVechi}” în „${ROLURI[rolNou as Rol]}”.`,
      confirmText: 'Schimbă rolul',
    })) return
    setUpdatingRoleId(user.id)
    try {
      const res = await apiFetch(`/api/users/${user.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: rolNou }) })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        const message = body?.code === 'LAST_ACTIVE_ADMIN' || body?.code === 'SELF_ACCOUNT_ACTION'
          ? lifecycleCodeMessage(body.code)
          : 'Nu am putut actualiza rolul. Reîncearcă.'
        showToast(message, 'error')
        return
      }
      fetchUsers()
      showToast('Rolul utilizatorului a fost actualizat.', 'success')
    } catch {
      showToast('Nu am putut actualiza rolul. Reîncearcă.', 'error')
    } finally {
      setUpdatingRoleId(null)
    }
  }

  const handleConfirmDelete = async () => {
    if (!userToDelete || checkingDelete || deleteHasRelatedData || deleteError || isDeleting) return
    setIsDeleting(true)
    setDeleteError(null)
    setDeleteBlockers([])
    setDeleteHasRelatedData(false)
    try {
      const res = await apiFetch('/api/users/' + userToDelete.id, { method: 'DELETE' })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        const blockers = Array.isArray(body?.details?.blockers) ? body.details.blockers : []
        if (body?.code === 'USER_HAS_RELATED_DATA') {
          setDeleteBlockers(blockers.filter((item: any) => typeof item?.kind === 'string' && Number.isFinite(item?.count)))
          setDeleteHasRelatedData(true)
          return
        }
        setDeleteError(lifecycleCodeMessage(body?.code))
        return
      }
      setDeleteModalOpen(false)
      setUserToDelete(null)
      fetchUsers()
    } catch {
      setDeleteError(lifecycleCodeMessage())
    } finally {
      setIsDeleting(false)
    }
  }

  useEffect(() => {
    if (!userToDelete) return
    let cancelled = false
    const load = async () => {
      setCheckingDelete(true)
      try {
        const res = await apiFetch('/api/users/' + userToDelete.id + '/lifecycle-impact')
        const body = await res.json().catch(() => null)
        if (cancelled) return
        if (!res.ok || !Array.isArray(body?.blockers) || !body.blockers.every((item: any) =>
          typeof item?.kind === 'string' && Number.isInteger(item.count) && item.count >= 0
        )) throw new Error('Invalid account blockers')
        const blockers = body.blockers.filter((item: any) => item.count > 0)
        setDeleteBlockers(blockers)
        setDeleteHasRelatedData(blockers.length > 0)
      } catch {
        if (!cancelled) setDeleteError('Nu am putut verifica legăturile contului. Închide dialogul și reîncearcă.')
      } finally {
        if (!cancelled) setCheckingDelete(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [userToDelete, apiFetch])

  const loadLifecycleImpact = (user: any) => {
    setImpactUser(user)
    setImpact(null)
    setImpactBlockers([])
    setImpactUnavailable(false)
    setLifecycleActionError(null)
  }

  useEffect(() => {
    if (!impactUser) return
    let cancelled = false
    const load = async () => {
      setLoadingImpact(true)
      try {
        const res = await apiFetch('/api/users/' + impactUser.id + '/lifecycle-impact')
        const body = await res.json().catch(() => null)
        if (cancelled) return
        if (!res.ok || !body?.impact) {
          setImpactUnavailable(true)
          return
        }
        setImpact(body.impact)
        setImpactBlockers(Array.isArray(body.blockers)
          ? body.blockers.filter((item: any) => typeof item?.kind === 'string' && Number.isFinite(item?.count))
          : [])
      } catch {
        if (!cancelled) setImpactUnavailable(true)
      } finally {
        if (!cancelled) setLoadingImpact(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [impactUser, apiFetch])

  const openImpactForDeletedUser = () => {
    const user = users.find((item) => item.id === userToDelete?.id)
    if (!user) return
    setDeleteModalOpen(false)
    setUserToDelete(null)
    setDeleteError(null)
    setDeleteBlockers([])
    setDeleteHasRelatedData(false)
    loadLifecycleImpact(user)
  }

  const changeLifecycle = async (user: any, action: 'deactivate' | 'reactivate') => {
    const deactivate = action === 'deactivate'
    if (!deactivate && !await confirm({
      title: 'Reactivează contul',
      description: 'Contul va putea accesa din nou platforma.',
      confirmText: 'Reactivează',
    })) return
    setChangingStateId(user.id)
    if (deactivate) setLifecycleActionError(null)
    try {
      const res = await apiFetch('/api/users/' + user.id + '/' + action, { method: 'POST' })
      const body = await res.json().catch(() => null)
      await fetchUsers(false)
      if (res.status === 503 && body?.code === 'AUTH_SYNC_INCOMPLETE') {
        setImpactUser(null)
        showToast(lifecycleCodeMessage(body.code), 'error')
      } else if (!res.ok) {
        const message = lifecycleCodeMessage(body?.code)
        if (deactivate) setLifecycleActionError(message)
        else showToast(message, 'error')
      } else {
        setImpactUser(null)
        showToast(deactivate ? 'Contul a fost dezactivat.' : 'Contul a fost reactivat.', 'success')
      }
    } catch {
      const message = lifecycleCodeMessage()
      if (deactivate) setLifecycleActionError(message)
      else showToast(message, 'error')
    } finally {
      setChangingStateId(null)
    }
  }
  const peRol = useMemo(() => {
    const c: Record<string, number> = { admin: 0, consultant: 0, client: 0 }
    for (const u of users) c[u.role as string] = (c[u.role as string] ?? 0) + 1
    return c
  }, [users])

  const filtrati = useMemo(() => {
    const q = cauta.trim().toLowerCase()
    return users.filter((u) => {
      if (filtruRol !== 'toate' && u.role !== filtruRol) return false
      if (!q) return true
      return `${u.email ?? ''} ${u.full_name ?? ''}`.toLowerCase().includes(q)
    })
  }, [users, cauta, filtruRol])

  if (authLoading || loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center" role="status" aria-live="polite">
        <Spinner size="md" />
        <span className="sr-only">Se încarcă utilizatorii…</span>
      </div>
    )
  }

  return (
    <div>
      <ConfirmDeleteModal
        isOpen={deleteModalOpen}
        onClose={() => { setDeleteModalOpen(false); setUserToDelete(null); setDeleteError(null); setDeleteBlockers([]); setDeleteHasRelatedData(false) }}
        onConfirm={handleConfirmDelete}
        title={deleteHasRelatedData ? 'Utilizatorul nu poate fi șters' : 'Șterge definitiv utilizatorul'}
        description={checkingDelete
          ? `Verificăm legăturile utilizatorului „${userToDelete?.email}”.`
          : deleteHasRelatedData
          ? `Utilizatorul „${userToDelete?.email}” are date asociate care trebuie păstrate.`
          : `Ștergi definitiv utilizatorul „${userToDelete?.email}”? Acțiunea nu poate fi anulată.`}
        confirmText="Șterge definitiv"
        confirmWord="sterge"
        loading={isDeleting}
        canConfirm={!checkingDelete && !deleteHasRelatedData && !deleteError}
        error={deleteError}
      >
        {userToDelete?.is_active === false && (
          <FeedbackMessage variant="info">Contul este deja dezactivat. Accesul este blocat, iar datele și istoricul sunt păstrate.</FeedbackMessage>
        )}
        {checkingDelete && <p className="text-sm text-ink-soft" role="status">Se verifică legăturile contului…</p>}
        {deleteHasRelatedData && (
          <div className="space-y-3 rounded-[var(--radius-plate)] border border-[var(--sg-warn)] p-3">
            <p className="text-sm font-semibold text-ink">Ștergerea nu este disponibilă. Legăturile găsite:</p>
            <ul className="space-y-1 text-sm text-ink-soft">
              {deleteBlockers.map((blocker, index) => (
                <li key={`${blocker.kind}-${index}`} className="flex justify-between gap-3">
                  <span>{blockerLabel(blocker.kind)}</span><span className="font-semibold tabular-nums">{blocker.count}</span>
                </li>
              ))}
            </ul>
            {userToDelete?.is_active && (
              <Button variant="secondary" onClick={openImpactForDeletedUser}>Dezactivează contul</Button>
            )}
          </div>
        )}
      </ConfirmDeleteModal>

      <Dialog.Root open={!!impactUser} onOpenChange={(open) => { if (!open) setImpactUser(null) }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[999999] backdrop-blur-sm" style={{ backgroundColor: 'rgb(22 24 28 / 0.45)' }} />
          <Dialog.Content
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              const trigger = lifecycleFocusReturnRef.current
              if (trigger?.isConnected) trigger.focus()
              else document.getElementById('admin-users-heading')?.focus()
              lifecycleFocusReturnRef.current = null
            }}
            className="fixed left-1/2 top-1/2 z-[1000000] max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[var(--radius-plate-lg)] bg-plate shadow-2xl focus:outline-none"
          >
            <div className="flex items-start justify-between gap-4 border-b border-rule px-5 py-4">
              <div>
                <Dialog.Title className="text-lg font-bold text-ink">Dezactivează contul</Dialog.Title>
                <Dialog.Description className="mt-1 text-sm text-ink-soft">
                  {impactUser?.email} nu va mai putea accesa platforma. Datele și istoricul rămân păstrate.
                </Dialog.Description>
              </div>
              <Dialog.Close asChild><IconButton label="Închide"><X className="h-4 w-4" /></IconButton></Dialog.Close>
            </div>
            <div className="space-y-4 px-5 py-5">
              {loadingImpact && <p className="text-sm text-ink-soft" role="status">Se încarcă impactul…</p>}
              {impactUnavailable && (
                <FeedbackMessage variant="warning">
                  Impactul nu este disponibil acum. Numărul de elemente nu este cunoscut; poți continua dezactivarea.
                </FeedbackMessage>
              )}
              {impact && (
                <dl className="grid grid-cols-2 gap-x-5 gap-y-3 text-sm">
                  <div><dt className="text-ink-soft">Activități</dt><dd className="font-semibold text-ink">{impact.activities}</dd></div>
                  <div><dt className="text-ink-soft">Cereri de documente</dt><dd className="font-semibold text-ink">{impact.documentRequests}</dd></div>
                  <div><dt className="text-ink-soft">Proiecte active</dt><dd className="font-semibold text-ink">{impact.activeProjects}</dd></div>
                  <div><dt className="text-ink-soft">Proiecte finalizate</dt><dd className="font-semibold text-ink">{impact.completedProjects}</dd></div>
                  <div><dt className="text-ink-soft">Proiecte cu consultant general</dt><dd className="font-semibold text-ink">{impact.generalConsultantProjects}</dd></div>
                  <div><dt className="text-ink-soft">Proiecte fără consultant senior activ</dt><dd className="font-semibold text-ink">{impact.projectsWithoutActiveSenior}</dd></div>
                </dl>
              )}
              {impactBlockers.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-ink">Legături care împiedică ștergerea</h3>
                  <ul className="mt-2 space-y-1 text-sm text-ink-soft">
                    {impactBlockers.map((blocker, index) => (
                      <li key={`${blocker.kind}-${index}`} className="flex justify-between gap-3">
                        <span>{blockerLabel(blocker.kind)}</span><span className="font-semibold tabular-nums">{blocker.count}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {lifecycleActionError && <FeedbackMessage variant="error">{lifecycleActionError}</FeedbackMessage>}
            </div>
            <div className="flex justify-end gap-2 border-t border-rule bg-paper-sunk px-5 py-4">
              <Dialog.Close asChild><Button variant="secondary">Anulează</Button></Dialog.Close>
              <Button variant="danger" disabled={changingStateId !== null} onClick={() => { if (impactUser) void changeLifecycle(impactUser, 'deactivate') }}>
                {changingStateId === impactUser?.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Dezactivează contul
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <LocationStrip
        segments={[{ label: 'Bonie', href: '/' }, { label: 'Utilizatori' }]}
        action={
          <Button variant="primary" aria-label="Adaugă utilizator" onClick={openCreatePanel}>
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Adaugă utilizator</span>
          </Button>
        }
      />

      <h1 id="admin-users-heading" tabIndex={-1} className="text-3xl font-bold tracking-tight text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sg-accent)] md:text-4xl">Utilizatori</h1>
      <p className="mt-2 text-sm text-ink-soft">
        {users.length} {users.length === 1 ? 'cont' : 'conturi'} · {peRol.client} clienți, {peRol.consultant} consultanți, {peRol.admin} administratori
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-2 border-b border-rule pb-3">
        <div className="min-w-[220px] flex-1">
          <SearchInput value={cauta} onChange={setCauta} placeholder="Caută după email sau nume…" label="Caută utilizatori" />
        </div>
        {/* `flex-wrap`: la 320px cele patru filtre nu încap pe un rând, iar
            `overflow-x-hidden` de pe `body` le-ar tăia în tăcere pe ultimul.
            DESIGN.md cere ruperea în rânduri, nu derularea. */}
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filtrează după rol">
          {(['toate', 'client', 'consultant', 'admin'] as const).map((r) => (
            <Button
              key={r}
              variant="secondary"
              size="sm"
              aria-pressed={filtruRol === r}
              onClick={() => setFiltruRol(r)}
              className={filtruRol === r ? 'border-[var(--sg-accent)] bg-[var(--sg-accent-soft)] text-[var(--sg-accent-ink)]' : ''}
            >
              {r === 'toate' ? 'Toate' : ROLURI[r].replace(' (firmă)', '')}
            </Button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1" role="group" aria-label="Filtrează după starea contului">
        {(['active', 'inactive', 'all'] as const).map((state) => (
          <Button key={state} variant="secondary" size="sm" aria-pressed={filtruStare === state} onClick={() => setFiltruStare(state)}
            className={filtruStare === state ? 'border-[var(--sg-accent)] bg-[var(--sg-accent-soft)] text-[var(--sg-accent-ink)]' : ''}>
            {state === 'active' ? 'Active' : state === 'inactive' ? 'Dezactivate' : 'Toate stările'}
          </Button>
        ))}
      </div>

      <div className="mt-4 flex flex-col gap-2 pb-10">
        {filtrati.length === 0 ? (
          <EmptyState
            title={users.length === 0 ? 'Niciun utilizator' : 'Niciun utilizator nu se potrivește'}
            action={users.length === 0
              ? <Button variant="primary" onClick={openCreatePanel}><UserPlus className="h-4 w-4" aria-hidden="true" /> Adaugă utilizator</Button>
              : <Button variant="secondary" onClick={() => { setCauta(''); setFiltruRol('toate') }}>Șterge filtrele</Button>}
          >
            {users.length === 0
              ? 'Primul cont deschide platforma pentru cineva: un client, un consultant sau un administrator.'
              : 'Încearcă alt termen de căutare, sau alege alt rol.'}
          </EmptyState>
        ) : (
          filtrati.map((user) => (
            <Plate key={user.id} interactive className="group">
              <div className="flex flex-wrap items-center gap-3 p-4 sm:flex-nowrap">
                <button
                  onClick={() => router.push(`/admin/users/${user.id}`)}
                  className="flex min-w-0 flex-1 basis-full items-center gap-3 text-left sm:basis-auto"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-ink transition-colors duration-[120ms] group-hover:text-[var(--sg-accent)]">
                      {user.email}
                    </span>
                    <span className="mt-0.5 block truncate text-sm text-ink-soft">
                      {user.full_name?.trim() || 'Fără nume'} · cont din {formatDate(user.created_at)}
                    </span>
                    {user.auth_sync_pending && (
                      <Signal tone="warn" className="mt-2 max-w-full">
                        Acces blocat · reîncearcă dezactivarea
                      </Signal>
                    )}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint transition-colors duration-[120ms] group-hover:text-[var(--sg-accent)]" aria-hidden="true" />
                </button>

                <div className="flex max-w-full flex-wrap items-center gap-2 sm:shrink-0 sm:flex-nowrap">
                  {user.role === 'consultant' && user.consultant_level === 'senior' && (
                    <span className="shrink-0 rounded-[var(--radius-plate)] border border-rule bg-paper-sunk px-2 py-0.5 text-xs font-semibold text-ink-soft">
                      Senior
                    </span>
                  )}
                  <label className="sr-only" htmlFor={`rol-${user.id}`}>Rolul lui {user.email}</label>
                  <select
                    id={`rol-${user.id}`}
                    value={user.role || 'client'}
                    onChange={e => updateUserRole(user, e.target.value)}
                    disabled={updatingRoleId === user.id}
                    className="h-11 rounded-[var(--radius-plate)] border border-rule bg-plate px-2 text-sm text-ink transition-colors duration-[120ms] focus:border-[var(--sg-accent)] disabled:opacity-55 sm:h-9"
                  >
                    <option value="client">Client</option>
                    <option value="consultant">Consultant</option>
                    <option value="admin">Administrator</option>
                  </select>
                  {updatingRoleId === user.id && <Loader2 className="h-4 w-4 animate-spin text-ink-soft" aria-hidden="true" />}
                  <span className={`rounded border px-2 py-1 text-xs font-semibold ${user.is_active === false ? 'border-rule text-ink-soft' : 'border-[var(--sg-ok)] text-[var(--sg-ok)]'}`}>
                    {user.is_active === false ? 'Dezactivat' : 'Activ'}
                  </span>
                  {user.is_active === false ? (
                    <IconButton
                      label={user.auth_sync_pending ? 'Reîncearcă dezactivarea pentru ' + user.email : 'Reactivează ' + user.email}
                      disabled={changingStateId !== null}
                      onClick={() => { void changeLifecycle(user, user.auth_sync_pending ? 'deactivate' : 'reactivate') }}
                    >
                      {changingStateId === user.id ? <Loader2 className="h-4 w-4 animate-spin" /> : user.auth_sync_pending ? <RotateCcw className="h-4 w-4" /> : <Power className="h-4 w-4" />}
                    </IconButton>
                  ) : (
                    <IconButton label={'Dezactivează ' + user.email} disabled={changingStateId !== null} onClick={(event) => { lifecycleFocusReturnRef.current = event.currentTarget; loadLifecycleImpact(user) }}>
                      <Power className="h-4 w-4" />
                    </IconButton>
                  )}
                  <IconButton
                    label={'Șterge definitiv utilizatorul ' + user.email}
                    tone="danger"
                    disabled={changingStateId !== null}
                    onClick={(event) => { lifecycleFocusReturnRef.current = event.currentTarget; setDeleteError(null); setDeleteBlockers([]); setDeleteHasRelatedData(false); setCheckingDelete(true); setUserToDelete({ id: user.id, email: user.email, is_active: user.is_active !== false }); setDeleteModalOpen(true) }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </IconButton>
                </div>
              </div>
            </Plate>
          ))
        )}
      </div>

      {panouDeschis && (
        <div className="fixed inset-0 z-[100] flex justify-end">
          <Scrim onClick={closeCreatePanel} />
          <FloatingSurface
            role="dialog"
            ariaModal
            ariaLabel="Adaugă utilizator"
            className="drawer-slide-in relative flex h-full w-full flex-col border-y-0 border-r-0 sm:max-w-lg"
          >
            <div className="flex items-center justify-between border-b border-rule px-5 py-4">
              <h2 className="text-base font-bold text-ink">Adaugă utilizator</h2>
              <IconButton
                label="Închide panoul"
                onClick={closeCreatePanel}
                disabled={isCreating}
                className="disabled:cursor-not-allowed disabled:opacity-55"
              >
                <X className="h-4 w-4" />
              </IconButton>
            </div>

            {fallbackCredentials ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
                  <FeedbackMessage variant="warning">
                    Contul a fost creat, dar emailul nu a putut fi trimis. Comunică manual parola de mai jos.
                  </FeedbackMessage>
                  <dl className="space-y-4 text-sm">
                    <div>
                      <dt className="mb-1 font-semibold text-ink">Emailul contului creat</dt>
                      <dd className="break-all text-ink-soft">{fallbackCredentials.email}</dd>
                    </div>
                    <div>
                      <dt className="mb-1 font-semibold text-ink">
                        <label htmlFor="fallback-password">Parola temporară generată</label>
                      </dt>
                      <dd>
                        <input
                          id="fallback-password"
                          type="text"
                          value={fallbackCredentials.password}
                          readOnly
                          autoComplete="off"
                          onFocus={e => e.currentTarget.select()}
                          className={inputClass}
                        />
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>
            ) : partialCreationUserId ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex-1 px-5 py-5">
                  <FeedbackMessage variant="error">
                    Contul de autentificare a fost creat, dar profilul nu a putut fi actualizat. Este necesară remedierea manuală. ID utilizator: {partialCreationUserId}
                  </FeedbackMessage>
                </div>
              </div>
            ) : (
            <form onSubmit={handleCreateUser} className="flex min-h-0 flex-1 flex-col">
              <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
                <fieldset>
                  <legend className="mb-2 text-sm font-semibold text-ink">Tip de cont</legend>
                  <div className="flex flex-col gap-1">
                    {(['client', 'consultant', 'admin'] as const).map((rol) => (
                      <label key={rol} className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-[var(--radius-plate)] px-2 transition-colors duration-[120ms] hover:bg-paper-sunk">
                        <input
                          type="radio"
                          name="rol"
                          value={rol}
                          checked={newRole === rol}
                          onChange={() => setNewRole(rol)}
                          className="h-4 w-4"
                        />
                        <span className="text-sm text-ink">{ROLURI[rol]}</span>
                      </label>
                    ))}
                  </div>
                  {newRole === 'admin' && (
                    <p className="mt-2 text-xs leading-relaxed text-ink-soft">
                      Administratorii văd și pot schimba tot: proiecte, utilizatori, șabloane și jurnalul de audit.
                    </p>
                  )}
                </fieldset>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Camp label="Email" required>
                    <input type="email" required placeholder="user@firma.ro" value={newEmail} onChange={e => setNewEmail(e.target.value)} className={inputClass} />
                  </Camp>
                  <Camp label="Nume complet" required>
                    <input type="text" required placeholder="Ion Popescu" value={newName} onChange={e => setNewName(e.target.value)} className={inputClass} />
                  </Camp>

                  <Camp label="Telefon">
                    <input type="tel" placeholder="0740123456" value={telefon} onChange={e => setTelefon(e.target.value)} className={inputClass} />
                  </Camp>
                </div>

                <fieldset className="border-t border-rule pt-5">
                  <legend className="sr-only">Detalii pentru {ROLURI[newRole]}</legend>
                  <p className="mb-3 text-sm font-semibold text-ink">Detalii pentru {ROLURI[newRole].toLowerCase()}</p>

                  {newRole === 'client' && (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <Camp label="CIF / CUI" required hint="Ex.: RO12345678">
                        <input type="text" required placeholder="RO12345678" value={cif} onChange={e => setCif(e.target.value)} className={inputClass} />
                      </Camp>
                      <Camp label="Nume firmă" required>
                        <input type="text" required placeholder="SC TECH SOLUTIONS SRL" value={numeFirma} onChange={e => setNumeFirma(e.target.value)} className={inputClass} />
                      </Camp>
                      <div className="sm:col-span-2">
                        <Camp label="Adresă firmă">
                          <input type="text" placeholder="Str. Principală nr. 10, București" value={adresaFirma} onChange={e => setAdresaFirma(e.target.value)} className={inputClass} />
                        </Camp>
                      </div>
                      <div className="sm:col-span-2">
                        <Camp label="Persoană de contact" hint="Completeaz-o doar dacă diferă de titularul contului.">
                          <input type="text" placeholder="Ana Popescu" value={persoanaContact} onChange={e => setPersoanaContact(e.target.value)} className={inputClass} />
                        </Camp>
                      </div>
                    </div>
                  )}

                  {newRole === 'consultant' && (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <Camp label="Specializare" required hint="Ex.: PNRR, Digitalizare IMM">
                        <input type="text" required placeholder="Digitalizare IMM, PNRR" value={specializare} onChange={e => setSpecializare(e.target.value)} className={inputClass} />
                      </Camp>
                      <Camp label="Departament">
                        <input type="text" placeholder="Departament Proiecte" value={departament} onChange={e => setDepartament(e.target.value)} className={inputClass} />
                      </Camp>
                    </div>
                  )}

                  {newRole === 'admin' && (
                    <Camp label="Departament">
                      <input type="text" placeholder="Management, IT" value={departament} onChange={e => setDepartament(e.target.value)} className={inputClass} />
                    </Camp>
                  )}
                </fieldset>
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-rule px-5 py-4">
                <p className="min-w-0 truncate text-sm text-ink-soft">
                  Creezi <span className="font-semibold text-ink">{newName || 'un cont nou'}</span> ca {ROLURI[newRole].toLowerCase()}.
                </p>
                <Button type="submit" variant="primary" disabled={isCreating}>
                  {isCreating
                    ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Se creează…</>
                    : <><UserPlus className="h-4 w-4" aria-hidden="true" /> Creează</>}
                </Button>
              </div>
            </form>
            )}
          </FloatingSurface>
        </div>
      )}
    </div>
  )
}
