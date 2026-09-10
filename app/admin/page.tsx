'use client'

import { useState, useEffect, Fragment } from 'react'
import { useRouter } from 'next/navigation'
import { FolderOpen, Plus, ChevronRight } from 'lucide-react'
import { useAuth } from '@/app/providers/AuthProvider'
import { LocationStrip } from '@/components/ui/LocationStrip'
import { ButtonLink } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'

interface ProjectStatus {
  id: string
  name: string
  slug: string
  color: string
  icon: string
  order_index: number
}

interface TemplateOverview {
  id: string
  name: string
  description: string | null
  phases: {
    id: string
    name: string
    project_status_id: string
    activities?: {
      id: string
      name: string
      document_requirements?: { id: string }[]
      default_consultant?: { id: string; full_name: string | null; email: string } | null
    }[]
  }[]
}

export default function AdminOverviewPage() {
  const router = useRouter()
  const { loading: authLoading, token, apiFetch } = useAuth()
  
  const [statuses, setStatuses] = useState<ProjectStatus[]>([])
  const [templates, setTemplates] = useState<TemplateOverview[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedTemplateIds, setExpandedTemplateIds] = useState<Set<string>>(new Set())

  const toggleTemplateExpanded = (templateId: string) => {
    setExpandedTemplateIds(current => {
      const next = new Set(current)
      if (next.has(templateId)) next.delete(templateId)
      else next.add(templateId)
      return next
    })
  }

  useEffect(() => {
    if (authLoading) return
    if (!token) { router.replace('/login'); return }
    
    const fetchData = async () => {
      try {
        const [statusesRes, templatesRes] = await Promise.all([
          apiFetch('/api/admin/statuses'),
          apiFetch('/api/admin/templates')
        ])
        
        if (statusesRes.ok) {
          const data = await statusesRes.json()
          setStatuses(data.statuses || [])
        }
        
        if (templatesRes.ok) {
          const data = await templatesRes.json()
          setTemplates(data.templates || [])
        }
      } catch (error) {
        console.error('Eroare:', error)
      } finally {
        setLoading(false)
      }
    }
    
    fetchData()
  }, [authLoading, token, router, apiFetch])

  const getStatusById = (id: string) => statuses.find(s => s.id === id)

  const getTotalActivities = (template: TemplateOverview) => 
    template.phases?.reduce((sum, p) => sum + (p.activities?.length || 0), 0) || 0

  const getTotalDocuments = (template: TemplateOverview) => 
    template.phases?.reduce((sum, p) => 
      sum + (p.activities?.reduce((aSum, a) => aSum + (a.document_requirements?.length || 0), 0) || 0), 0) || 0

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-paper-sunk flex items-center justify-center">
        <Spinner size="md" />
      </div>
    )
  }

  const totalFaze = templates.reduce((sum, t) => sum + (t.phases?.length || 0), 0)
  const totalActivitati = templates.reduce((sum, t) => sum + getTotalActivities(t), 0)

  return (
    <div>
      <LocationStrip
        segments={[{ label: 'Bonie', href: '/' }, { label: 'Șabloane' }]}
        action={
          <>
            <ButtonLink href="/projects/new" variant="secondary" label="Proiect nou">
              <FolderOpen className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Proiect nou</span>
            </ButtonLink>
            <ButtonLink href="/admin/templates" variant="primary" label="Șablon nou">
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Șablon nou</span>
            </ButtonLink>
          </>
        }
      />

      <h1 className="text-3xl font-bold tracking-tight text-ink md:text-4xl">Șabloane</h1>
      {/* Cifrele stau într-o propoziție. Trei casete cu numere mari spuneau
          același lucru, ocupau un ecran și nu duceau nicăieri. */}
      <p className="mt-2 text-sm text-ink-soft">
        {templates.length} {templates.length === 1 ? 'șablon' : 'șabloane'} · {totalFaze} {totalFaze === 1 ? 'fază' : 'faze'} · {totalActivitati} {totalActivitati === 1 ? 'activitate' : 'activități'}
      </p>

      <div className="mt-8 pb-10">
        {templates.length === 0 ? (
          <div className="rounded-[var(--radius-plate)] border border-dashed border-rule-strong px-6 py-12 text-center">
            <p className="text-base font-semibold text-ink">Niciun șablon</p>
            <p className="mx-auto mt-2 max-w-[52ch] text-sm leading-6 text-ink-soft">
              Un șablon codifică felul în care lucrezi un tip de finanțare: fazele, activitățile și documentele cerute. Un proiect nou pornește din el, nu de la zero.
            </p>
            <div className="mt-5 flex justify-center">
              <ButtonLink href="/admin/templates" variant="primary">
                <Plus className="h-4 w-4" aria-hidden="true" /> Creează primul șablon
              </ButtonLink>
            </div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-[var(--radius-plate)] border border-rule bg-plate">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-rule bg-paper-sunk">
                    <th scope="col" className="w-full px-4 py-2.5 text-left text-[11px] font-normal uppercase tracking-[0.08em] text-ink-faint">Șablon</th>
                    <th scope="col" className="whitespace-nowrap px-4 py-2.5 text-right text-[11px] font-normal uppercase tracking-[0.08em] text-ink-faint">Faze</th>
                    <th scope="col" className="whitespace-nowrap px-4 py-2.5 text-right text-[11px] font-normal uppercase tracking-[0.08em] text-ink-faint">Activități</th>
                    <th scope="col" className="whitespace-nowrap px-4 py-2.5 text-right text-[11px] font-normal uppercase tracking-[0.08em] text-ink-faint">Documente</th>
                  </tr>
                </thead>
                <tbody>
                  {templates.map((template) => {
                    const phaseCount = template.phases?.length || 0
                    const expanded = expandedTemplateIds.has(template.id)
                    const detailsId = `faze-sablon-${template.id}`
                    return (
                      <Fragment key={template.id}>
                        <tr
                          onClick={() => phaseCount > 0 && toggleTemplateExpanded(template.id)}
                          className={`border-b border-rule last:border-b-0 transition-colors ${phaseCount > 0 ? 'cursor-pointer hover:bg-paper-sunk' : ''} ${expanded ? 'bg-paper-sunk' : ''}`}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              {phaseCount > 0 ? (
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); toggleTemplateExpanded(template.id) }}
                                  aria-expanded={expanded}
                                  aria-controls={expanded ? detailsId : undefined}
                                  aria-label={`${expanded ? 'Ascunde' : 'Arată'} fazele — ${template.name}`}
                                  className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-ink-faint transition-colors hover:text-ink"
                                >
                                  <ChevronRight className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`} aria-hidden />
                                </button>
                              ) : (
                                <span className="w-6 flex-shrink-0" aria-hidden />
                              )}
                              <div className="min-w-0">
                                <span className="font-medium text-ink">{template.name}</span>
                                {template.description && (
                                  <span className="ml-2 truncate text-ink-soft">{template.description}</span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-ink-soft">{phaseCount}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-ink-soft">{getTotalActivities(template)}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-ink-soft">{getTotalDocuments(template)}</td>
                        </tr>
                        {expanded && phaseCount > 0 && (
                          <tr id={detailsId} className="border-b border-rule bg-paper-sunk last:border-b-0">
                            <td colSpan={4} className="px-4 py-3 pl-11">
                              <ol className="flex flex-col gap-2">
                                {template.phases.map((phase, index) => {
                                  const status = getStatusById(phase.project_status_id)
                                  return (
                                    <li key={phase.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                                      {/* Culoarea statusului e aleasă de administrator, deci
                                          nu poate garanta contrast pe text alb. O purtăm ca
                                          semn de identitate pe muchie, cu numele în cerneală. */}
                                      <span
                                        aria-hidden="true"
                                        className="mt-1 h-3.5 w-[var(--sg-rail)] shrink-0 self-start rounded-[1px]"
                                        style={{ background: status?.color || 'var(--sg-rule-strong)' }}
                                      />
                                      <span className="w-5 shrink-0 text-ink-faint">{index + 1}.</span>
                                      <span className="min-w-0 flex-1 font-medium text-ink">{phase.name}</span>
                                      {status && <span className="shrink-0 text-ink-soft">{status.name}</span>}
                                      <span className="shrink-0 text-ink-faint">
                                        {phase.activities?.length || 0} {phase.activities?.length === 1 ? 'activitate' : 'activități'}
                                      </span>
                                    </li>
                                  )
                                })}
                              </ol>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
