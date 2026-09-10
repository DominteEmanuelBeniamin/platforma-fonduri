'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { FolderOpen, Plus } from 'lucide-react'
import { useAuth } from '@/app/providers/AuthProvider'
import { LocationStrip } from '@/components/ui/LocationStrip'
import { ButtonLink } from '@/components/ui/Button'
import { Plate } from '@/components/ui/Plate'
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
          <div className="flex flex-col gap-3">
            {templates.map((template) => (
              <Plate key={template.id}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-rule px-5 py-4">
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-bold text-ink">{template.name}</h2>
                    {template.description && (
                      <p className="mt-0.5 truncate text-sm text-ink-soft">{template.description}</p>
                    )}
                  </div>
                  <p className="shrink-0 text-sm text-ink-soft">
                    {template.phases?.length || 0} faze · {getTotalActivities(template)} activități · {getTotalDocuments(template)} documente
                  </p>
                </div>

                <div className="px-5 py-4">
                  {!template.phases || template.phases.length === 0 ? (
                    <p className="text-sm text-ink-soft">Nicio fază configurată.</p>
                  ) : (
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
                  )}
                </div>
              </Plate>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
