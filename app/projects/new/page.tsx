'use client'

import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Check, FolderPlus, Layers, Loader2, SquareDashed } from 'lucide-react'
import { useAuth } from '@/app/providers/AuthProvider'
import { useToast } from '@/app/providers/ToastProvider'
import { LocationStrip } from '@/components/ui/LocationStrip'
import { Button, ButtonLink } from '@/components/ui/Button'
import SupervisorPicker, { type SeniorConsultant } from '@/components/SupervisorPicker'
import { canCreateProjects } from '@/lib/project-permissions'
import { bandFor, bandVar } from '@/lib/signage'

interface ClientProfile {
  id: string
  full_name?: string | null
  nume_firma?: string | null
  email?: string | null
  cif?: string | null
}

interface TemplateActivity {
  id: string
  name: string
  order_index: number
  default_consultant_id?: string | null
}

interface TemplateData {
  id: string
  name: string
  description: string | null
  status?: string
  is_active?: boolean
  phases: {
    id: string
    name: string
    order_index: number
    activities?: TemplateActivity[]
  }[]
}

interface Consultant {
  id: string
  full_name: string | null
  email: string
  role?: string
  consultant_level?: 'junior' | 'senior' | null
}

type Structure = 'empty' | 'template'

const TITLE_MAX = 120

const fieldClass =
  'block w-full min-h-11 rounded-[var(--radius-plate)] border border-rule-strong bg-plate px-3 text-sm text-ink ' +
  'placeholder:text-ink-faint transition-colors duration-[120ms] hover:border-ink-faint ' +
  'focus:border-[var(--sg-accent)] disabled:opacity-55 pointer-fine:min-h-10'

function clientLabel(client: ClientProfile) {
  return client.nume_firma || client.full_name || client.email || 'Client fără nume'
}

function activityCount(template: TemplateData) {
  return template.phases.reduce((sum, phase) => sum + (phase.activities?.length ?? 0), 0)
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * O secțiune a foii: titlul, o frază despre ce se cere și câmpurile dedesubt.
 * Secțiunile se despart prin linie, pe aceeași foaie — un dosar, nu un teanc
 * de carduri.
 */
function FormSection({
  title,
  description,
  aside,
  children,
}: {
  title: string
  description: ReactNode
  aside?: ReactNode
  children: ReactNode
}) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="border-t border-rule px-5 py-7 first:border-t-0 sm:px-8 sm:py-8">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id={id} className="text-lg font-bold text-ink">{title}</h2>
        {aside ? <div className="shrink-0">{aside}</div> : null}
      </div>
      <p className="mt-1 max-w-[62ch] text-sm leading-6 text-ink-soft">{description}</p>
      <div className="mt-5">{children}</div>
    </section>
  )
}

/** Opțiune de tip radio desenată ca plăcuță; inputul real rămâne pentru tastatură. */
function ChoicePlate({
  name,
  checked,
  onSelect,
  icon,
  title,
  detail,
  disabled,
}: {
  name: string
  checked: boolean
  onSelect: () => void
  icon: ReactNode
  title: string
  detail: string
  disabled?: boolean
}) {
  return (
    <label
      className={`relative flex min-h-16 items-start gap-3 rounded-[var(--radius-plate)] border px-4 py-3.5 transition-colors duration-[120ms] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--sg-accent)] ${
        disabled
          ? 'cursor-not-allowed border-rule bg-paper-sunk opacity-70'
          : checked
          ? 'cursor-pointer border-[var(--sg-accent)] bg-[var(--sg-accent-soft)]'
          : 'cursor-pointer border-rule bg-plate hover:border-rule-strong hover:bg-paper-sunk/60'
      }`}
    >
      <input type="radio" name={name} className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0 disabled:cursor-not-allowed" checked={checked} onChange={onSelect} disabled={disabled} />
      <span className={`mt-0.5 shrink-0 ${checked ? 'text-[var(--sg-accent)]' : 'text-ink-soft'}`} aria-hidden="true">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-ink">{title}</span>
        <span className="mt-0.5 block text-xs leading-5 text-ink-soft">{detail}</span>
      </span>
      <Check
        aria-hidden="true"
        strokeWidth={2.5}
        className={`mt-0.5 h-5 w-5 shrink-0 text-[var(--sg-accent)] transition-opacity duration-[120ms] ${checked ? 'opacity-100' : 'opacity-0'}`}
      />
    </label>
  )
}

export default function NewProjectPage() {
  const { apiFetch, token, loading: authLoading, userId, profile } = useAuth()
  const { showToast } = useToast()
  const router = useRouter()

  const [title, setTitle] = useState('')
  const [clientId, setClientId] = useState('')
  const [clients, setClients] = useState<ClientProfile[]>([])
  const [loadingClients, setLoadingClients] = useState(true)

  const [consultants, setConsultants] = useState<Consultant[]>([])
  const [supervisorIds, setSupervisorIds] = useState<string[]>([])
  const [supervisorsTouched, setSupervisorsTouched] = useState(false)

  const [structure, setStructure] = useState<Structure>('empty')
  const [templates, setTemplates] = useState<TemplateData[]>([])
  const [templateId, setTemplateId] = useState<string | null>(null)
  // Alegeri explicite per activitate din șablon; '' înseamnă „fără consultant”.
  // O activitate care lipsește de aici păstrează consultantul implicit din șablon.
  const [activityConsultants, setActivityConsultants] = useState<Record<string, string>>({})
  const [loadingData, setLoadingData] = useState(true)

  const [submitting, setSubmitting] = useState(false)

  // Dosare deschid doar adminul și consultantul senior; juniorul și clientul
  // se întorc pe prima pagină. Datele formularului nu așteaptă profilul (s-ar
  // încărca una după alta), dar nu se mai cer după un refuz.
  const refused = !!profile && !canCreateProjects(profile)
  useEffect(() => {
    if (refused) router.replace('/')
  }, [refused, router])

  useEffect(() => {
    if (authLoading || !token || refused) return
    let cancelled = false
    const load = async () => {
      try {
        const [clientsRes, templatesRes, usersRes] = await Promise.all([
          apiFetch('/api/clients'),
          apiFetch('/api/admin/templates'),
          apiFetch('/api/users'),
        ])
        if (cancelled) return
        if (clientsRes.ok) setClients((await clientsRes.json()).clients || [])
        if (templatesRes.ok) {
          const all: TemplateData[] = (await templatesRes.json()).templates || []
          setTemplates(all.filter(t => t.status === 'published' && t.is_active))
        }
        if (usersRes.ok) {
          const list: Consultant[] = ((await usersRes.json()).users || []).filter((u: Consultant) => u.role === 'consultant')
          setConsultants(list)
          // Un consultant senior care deschide dosarul e propus ca supervizor.
          if (userId && list.some(c => c.id === userId && c.consultant_level === 'senior')) {
            setSupervisorIds(prev => (prev.length === 0 ? [userId] : prev))
          }
        }
      } catch (error) {
        console.error('Eroare la încărcarea formularului:', error)
      } finally {
        if (!cancelled) {
          setLoadingClients(false)
          setLoadingData(false)
        }
      }
    }
    load()
    return () => { cancelled = true }
  }, [apiFetch, authLoading, token, userId, refused])

  const seniors: SeniorConsultant[] = useMemo(
    () => consultants.filter(c => c.consultant_level === 'senior'),
    [consultants]
  )
  const selectedTemplate = templates.find(t => t.id === templateId) ?? null
  const selectedClient = clients.find(c => c.id === clientId) ?? null

  const consultantFor = (activity: TemplateActivity) =>
    activity.id in activityConsultants ? activityConsultants[activity.id] : (activity.default_consultant_id ?? '')

  const missing = [
    !title.trim() && 'numele',
    !clientId && 'beneficiarul',
    supervisorIds.length === 0 && 'un supervizor',
    structure === 'template' && !selectedTemplate && 'șablonul',
  ].filter(Boolean) as string[]
  const ready = missing.length === 0

  const chooseStructure = (next: Structure) => {
    setStructure(next)
    if (next === 'empty') setTemplateId(null)
    else if (!templateId && templates.length === 1) setTemplateId(templates[0].id)
  }

  const chooseTemplate = (id: string) => {
    setTemplateId(id)
    setActivityConsultants({})
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!ready) {
      setSupervisorsTouched(true)
      return
    }
    setSubmitting(true)

    let projectId: string | null = null
    try {
      const projectRes = await apiFetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), client_id: clientId, supervisor_ids: supervisorIds }),
      })
      const projectData = await projectRes.json().catch(() => null)
      if (!projectRes.ok || !projectData?.project?.id) throw new Error(projectData?.error || 'create')
      projectId = projectData.project.id as string

      if (structure === 'template' && selectedTemplate) {
        // Consultantul fiecărei activități (alegerea din formular sau cel implicit
        // din șablon) pleacă odată cu importul: serverul îl pune în echipă și îi
        // atribuie activitatea în aceeași cerere.
        const assignments = Object.fromEntries(
          selectedTemplate.phases
            .flatMap(p => p.activities || [])
            .map(activity => [activity.id, consultantFor(activity)])
            .filter(([, consultantId]) => consultantId)
        )
        const importRes = await apiFetch(`/api/projects/${projectId}/import-template`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ template_id: selectedTemplate.id, assignments }),
        })
        if (!importRes.ok) throw new Error('import')
      }

      router.push(`/projects/${projectId}`)
    } catch {
      if (projectId) {
        // Dosarul există deja; un al doilea click ar crea un duplicat. Mergem în
        // el și spunem ce a rămas de făcut.
        showToast('Dosarul a fost deschis, dar șablonul nu s-a importat complet. Verifică fazele din proiect.', 'error')
        router.push(`/projects/${projectId}`)
        return
      }
      showToast('Nu am putut deschide dosarul. Verifică datele și reîncearcă.', 'error')
      setSubmitting(false)
    }
  }

  const summary = [
    selectedClient ? `pentru ${clientLabel(selectedClient)}` : null,
    supervisorIds.length > 0 ? plural(supervisorIds.length, 'supervizor', 'supervizori') : null,
    structure === 'template'
      ? selectedTemplate ? `din „${selectedTemplate.name}”` : null
      : 'fără faze',
  ].filter(Boolean).join(' · ')

  if (refused) return null

  return (
    <div>
      <LocationStrip segments={[{ label: 'Proiecte', href: '/' }, { label: 'Dosar nou' }]} />

      <div className="mx-auto max-w-3xl">
      <h1 className="text-3xl font-bold tracking-tight text-ink md:text-4xl">Dosar nou</h1>
      <p className="mt-2 max-w-[62ch] text-sm leading-6 text-ink-soft">
        Un dosar are un nume, un beneficiar și cel puțin un supervizor. Fazele și activitățile le poți importa dintr-un șablon
        sau le adaugi mai târziu, din proiect.
      </p>
      </div>

      <form onSubmit={handleCreate} noValidate className="mt-8">
        <div className="mx-auto max-w-3xl rounded-[var(--radius-plate)] border border-rule bg-plate">
        <FormSection title="Dosarul" description="Numele după care îl găsesc colegii și firma pentru care se depune.">
          <div className="space-y-5">
            <div>
              <div className="flex items-baseline justify-between gap-3">
                <label htmlFor="dosar-nume" className="text-sm font-semibold text-ink">Numele proiectului</label>
                <span className={`text-xs tabular-nums ${title.length > TITLE_MAX - 10 ? 'text-ink-soft' : 'text-ink-faint'}`} aria-hidden="true">
                  {title.length}/{TITLE_MAX}
                </span>
              </div>
              <input
                id="dosar-nume"
                name="title"
                type="text"
                value={title}
                maxLength={TITLE_MAX}
                autoComplete="off"
                required
                placeholder="De exemplu: Agro Verde — dotare fermă legumicolă"
                onChange={e => setTitle(e.target.value)}
                className={`${fieldClass} mt-1.5`}
              />
            </div>

            <div>
              <label htmlFor="dosar-beneficiar" className="text-sm font-semibold text-ink">Beneficiar</label>
              {loadingClients ? (
                <p className="mt-1.5 flex min-h-11 items-center gap-2 text-sm text-ink-soft" role="status">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Se încarcă clienții…
                </p>
              ) : clients.length === 0 ? (
                <p className="mt-1.5 rounded-[var(--radius-plate)] border border-dashed border-rule-strong px-4 py-3 text-sm text-ink-soft">
                  Nu există încă niciun client. {profile?.role === 'admin'
                    ? <><Link href="/admin/users" className="font-semibold text-[var(--sg-accent)] underline underline-offset-2">Creează contul clientului</Link>, apoi revino aici.</>
                    : 'Cere unui administrator să creeze contul clientului.'}
                </p>
              ) : (
                <select
                  id="dosar-beneficiar"
                  name="client_id"
                  value={clientId}
                  required
                  onChange={e => setClientId(e.target.value)}
                  className={`${fieldClass} mt-1.5 ${clientId ? '' : 'text-ink-soft'}`}
                >
                  <option value="">Alege firma beneficiară</option>
                  {clients.map(client => (
                    <option key={client.id} value={client.id}>
                      {clientLabel(client)}{client.cif ? ` · CIF ${client.cif}` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
        </FormSection>

        <FormSection
          title="Supervizori"
          description="Consultanții seniori care răspund de dosar. Intră în echipa proiectului și îl pot administra: echipa, fazele și activitățile, chatul."
          aside={
            <span className={`text-xs font-semibold tabular-nums ${supervisorIds.length ? 'text-[var(--sg-accent)]' : 'text-ink-soft'}`} aria-live="polite">
              {supervisorIds.length ? `${supervisorIds.length} ${supervisorIds.length === 1 ? 'ales' : 'aleși'}` : 'Minim unul'}
            </span>
          }
        >
          <SupervisorPicker
            seniors={seniors}
            selected={supervisorIds}
            onChange={ids => { setSupervisorIds(ids); setSupervisorsTouched(true) }}
            loading={loadingData}
            currentUserId={userId}
            isAdmin={profile?.role === 'admin'}
            showError={supervisorsTouched}
          />
        </FormSection>

        <FormSection
          title="Structura"
          description="Pornește gol sau importă fazele și activitățile unui șablon publicat. Oricum ar porni, structura se poate schimba din proiect."
        >
          <fieldset>
            <legend className="sr-only">Cum pornește dosarul</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <ChoicePlate
                name="structura"
                checked={structure === 'empty'}
                onSelect={() => chooseStructure('empty')}
                icon={<SquareDashed className="h-5 w-5" />}
                title="Dosar gol"
                detail="Fără faze. Le adaugi din proiect."
              />
              <ChoicePlate
                name="structura"
                checked={structure === 'template'}
                onSelect={() => chooseStructure('template')}
                icon={<Layers className="h-5 w-5" />}
                title="Din șablon"
                detail={loadingData
                  ? 'Se încarcă șabloanele…'
                  : templates.length === 0
                  ? 'Nu există șabloane publicate.'
                  : `${plural(templates.length, 'șablon publicat', 'șabloane publicate')}.`}
                disabled={!loadingData && templates.length === 0}
              />
            </div>
          </fieldset>

          {structure === 'template' && templates.length > 0 && (
            <div className="mt-6">
              <fieldset>
                <legend className="text-sm font-semibold text-ink">Șablonul</legend>
                <ul className="mt-2 divide-y divide-rule rounded-[var(--radius-plate)] border border-rule bg-plate">
                  {templates.map(template => {
                    const checked = template.id === templateId
                    return (
                      <li key={template.id}>
                        <label
                          className={`relative flex min-h-14 cursor-pointer items-center gap-3 px-4 py-3 transition-colors duration-[120ms] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-[var(--sg-accent)] ${
                            checked ? 'bg-[var(--sg-accent-soft)]' : 'hover:bg-paper-sunk/60'
                          }`}
                        >
                          <input type="radio" name="sablon" className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0 disabled:cursor-not-allowed" checked={checked} onChange={() => chooseTemplate(template.id)} />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold text-ink">{template.name}</span>
                            {template.description && (
                              <span className="mt-0.5 block text-xs leading-5 text-ink-soft line-clamp-2">{template.description}</span>
                            )}
                          </span>
                          <span className="shrink-0 text-right text-xs tabular-nums text-ink-soft">
                            {plural(template.phases.length, 'fază', 'faze')}
                            <span className="hidden sm:inline"> · {plural(activityCount(template), 'activitate', 'activități')}</span>
                          </span>
                          <Check
                            aria-hidden="true"
                            strokeWidth={2.5}
                            className={`h-5 w-5 shrink-0 text-[var(--sg-accent)] ${checked ? 'opacity-100' : 'opacity-0'}`}
                          />
                        </label>
                      </li>
                    )
                  })}
                </ul>
              </fieldset>

              {selectedTemplate && (
                <div className="mt-6">
                  <h3 className="text-sm font-semibold text-ink">Cine lucrează fiecare activitate</h3>
                  <p className="mt-1 max-w-[62ch] text-xs leading-5 text-ink-soft">
                    Pornește de la consultantul propus în șablon. Poți schimba oricând din proiect.
                  </p>
                  {selectedTemplate.phases.length === 0 ? (
                    <p className="mt-3 text-sm text-ink-soft">Șablonul nu are faze.</p>
                  ) : (
                    <ol className="mt-3 space-y-3">
                      {selectedTemplate.phases.map((phase, index) => (
                        <li key={phase.id} className="relative overflow-hidden rounded-[var(--radius-plate)] border border-rule bg-plate">
                          <span aria-hidden="true" className="absolute inset-x-0 top-0 h-[var(--sg-rail)]" style={{ background: bandVar(bandFor(index)) }} />
                          <div className="flex items-baseline gap-2 px-4 pb-2 pt-4">
                            <span className="text-xs font-bold tabular-nums text-ink-faint">{index + 1}</span>
                            <span className="min-w-0 flex-1 text-sm font-bold text-ink">{phase.name}</span>
                            <span className="shrink-0 text-xs text-ink-soft">{plural(phase.activities?.length ?? 0, 'activitate', 'activități')}</span>
                          </div>
                          {(phase.activities?.length ?? 0) > 0 && (
                            <ul className="divide-y divide-rule border-t border-rule">
                              {phase.activities!.map(activity => {
                                const selectId = `consultant-${activity.id}`
                                return (
                                  <li key={activity.id} className="flex flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center sm:gap-4">
                                    <label htmlFor={selectId} className="min-w-0 flex-1 text-sm text-ink">{activity.name}</label>
                                    <select
                                      id={selectId}
                                      value={consultantFor(activity)}
                                      onChange={e => setActivityConsultants(prev => ({ ...prev, [activity.id]: e.target.value }))}
                                      className={`${fieldClass} sm:w-56 sm:shrink-0 ${consultantFor(activity) ? '' : 'text-ink-soft'}`}
                                    >
                                      <option value="">Fără consultant</option>
                                      {consultants.map(c => (
                                        <option key={c.id} value={c.id}>{c.full_name || c.email}</option>
                                      ))}
                                    </select>
                                  </li>
                                )
                              })}
                            </ul>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}
            </div>
          )}
        </FormSection>

        </div>

        {/* Bara de acțiuni rămâne la vedere cât derulezi prin șablon și spune
            ce mai lipsește, ca butonul dezactivat să nu fie o ghicitoare. */}
        <div className="sticky bottom-0 z-10 -mx-4 mt-8 border-t border-rule bg-paper px-4 py-3 sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10">
          <div className="mx-auto flex max-w-3xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="min-w-0 text-sm leading-5" aria-live="polite">
              {ready ? (
                <>
                  <span className="flex items-center gap-1.5 font-semibold text-ink">
                    <Check className="h-4 w-4 shrink-0 text-[var(--sg-accent)]" aria-hidden="true" />
                    <span className="truncate">„{title.trim()}”</span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-ink-soft">{summary}</span>
                </>
              ) : (
                <span className="text-ink-soft">
                  Mai lipsește {missing.length > 1 ? `${missing.slice(0, -1).join(', ')} și ${missing[missing.length - 1]}` : missing[0]}.
                </span>
              )}
            </p>
            <div className="flex shrink-0 gap-2">
              <ButtonLink href="/" variant="quiet" className="flex-1 sm:flex-none">Anulează</ButtonLink>
              <Button type="submit" variant="primary" disabled={!ready || submitting} className="flex-1 sm:flex-none">
                {submitting
                  ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  : <FolderPlus className="h-4 w-4" aria-hidden="true" />}
                {submitting ? 'Se deschide…' : 'Deschide dosarul'}
              </Button>
            </div>
          </div>
        </div>
      </form>
    </div>
  )
}
