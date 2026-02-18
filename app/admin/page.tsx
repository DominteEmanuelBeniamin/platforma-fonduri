'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { 
  Layers, Activity, FileText, FolderOpen, 
  ChevronRight, Settings, Plus, Eye,
  CheckCircle, Clock, AlertCircle
} from 'lucide-react'
import { useAuth } from '@/app/providers/AuthProvider'

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
    activities?: { id: string; name: string; document_requirements?: { id: string }[] }[]
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
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900">Admin Overview</h1>
          <p className="text-slate-500 mt-1">Vizualizare rapidă a statusurilor și template-urilor configurate</p>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
                <CheckCircle className="w-5 h-5 text-indigo-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900">{statuses.length}</p>
                <p className="text-sm text-slate-500">Statusuri</p>
              </div>
            </div>
          </div>
          
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                <Layers className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900">{templates.length}</p>
                <p className="text-sm text-slate-500">Template-uri</p>
              </div>
            </div>
          </div>
          
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center">
                <FolderOpen className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900">
                  {templates.reduce((sum, t) => sum + (t.phases?.length || 0), 0)}
                </p>
                <p className="text-sm text-slate-500">Faze totale</p>
              </div>
            </div>
          </div>
          
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center">
                <Activity className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900">
                  {templates.reduce((sum, t) => sum + getTotalActivities(t), 0)}
                </p>
                <p className="text-sm text-slate-500">Activități totale</p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Statusuri */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
              <h2 className="font-semibold text-slate-900 flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-indigo-600" />
                Statusuri Proiect
              </h2>
              <Link href="/admin/statuses" className="text-xs text-indigo-600 hover:text-indigo-700 flex items-center gap-1">
                <Settings className="w-3 h-3" /> Gestionează
              </Link>
            </div>
            
            <div className="p-4">
              {statuses.length === 0 ? (
                <div className="text-center py-8">
                  <AlertCircle className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                  <p className="text-sm text-slate-500">Niciun status configurat</p>
                  <Link href="/admin/statuses" className="text-sm text-indigo-600 hover:underline mt-2 inline-block">
                    Adaugă primul status →
                  </Link>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {statuses.map((status, index) => (
                    <div
                      key={status.id}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium text-white"
                      style={{ backgroundColor: status.color }}
                    >
                      <span className="w-5 h-5 bg-white/20 rounded-full flex items-center justify-center text-xs">
                        {index + 1}
                      </span>
                      {status.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Link-uri rapide */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-100">
              <h2 className="font-semibold text-slate-900 flex items-center gap-2">
                <Settings className="w-4 h-4 text-slate-600" />
                Acțiuni rapide
              </h2>
            </div>
            
            <div className="p-4 space-y-2">
              <Link href="/admin/statuses" className="flex items-center gap-3 p-3 rounded-lg border border-slate-100 hover:border-indigo-200 hover:bg-indigo-50 transition-colors">
                <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
                  <Plus className="w-5 h-5 text-indigo-600" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-slate-900">Adaugă Status</p>
                  <p className="text-xs text-slate-500">Configurează etapele mari ale proiectelor</p>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400" />
              </Link>
              
              <Link href="/admin/templates" className="flex items-center gap-3 p-3 rounded-lg border border-slate-100 hover:border-purple-200 hover:bg-purple-50 transition-colors">
                <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                  <Plus className="w-5 h-5 text-purple-600" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-slate-900">Adaugă Template</p>
                  <p className="text-xs text-slate-500">Creează template-uri cu faze și activități</p>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400" />
              </Link>
              
              <Link href="/projects/new" className="flex items-center gap-3 p-3 rounded-lg border border-slate-100 hover:border-emerald-200 hover:bg-emerald-50 transition-colors">
                <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center">
                  <FolderOpen className="w-5 h-5 text-emerald-600" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-slate-900">Proiect Nou</p>
                  <p className="text-xs text-slate-500">Creează un proiect folosind un template</p>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400" />
              </Link>
            </div>
          </div>
        </div>

        {/* Template-uri detaliate */}
        <div className="mt-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-slate-900">Template-uri configurate</h2>
            <Link href="/admin/templates" className="text-sm text-indigo-600 hover:text-indigo-700 flex items-center gap-1">
              <Eye className="w-4 h-4" /> Vezi toate
            </Link>
          </div>

          {templates.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
              <Layers className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="font-medium text-slate-900 mb-1">Niciun template creat</p>
              <p className="text-sm text-slate-500 mb-4">Creează un template pentru a putea genera proiecte rapid</p>
              <Link href="/admin/templates" className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">
                <Plus className="w-4 h-4" /> Creează template
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              {templates.map((template) => (
                <div key={template.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  {/* Template header */}
                  <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center">
                        <Layers className="w-4 h-4 text-purple-600" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-slate-900">{template.name}</h3>
                        {template.description && (
                          <p className="text-xs text-slate-500">{template.description}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-slate-500">
                      <span className="flex items-center gap-1">
                        <FolderOpen className="w-3.5 h-3.5" />
                        {template.phases?.length || 0} faze
                      </span>
                      <span className="flex items-center gap-1">
                        <Activity className="w-3.5 h-3.5" />
                        {getTotalActivities(template)} activități
                      </span>
                      <span className="flex items-center gap-1">
                        <FileText className="w-3.5 h-3.5" />
                        {getTotalDocuments(template)} documente
                      </span>
                    </div>
                  </div>
                  
                  {/* Faze vizualizare */}
                  <div className="p-4">
                    {!template.phases || template.phases.length === 0 ? (
                      <p className="text-sm text-slate-500 text-center py-4">Nicio fază configurată</p>
                    ) : (
                      <div className="flex items-start gap-2 overflow-x-auto pb-2">
                        {template.phases.map((phase, index) => {
                          const status = getStatusById(phase.project_status_id)
                          return (
                            <div key={phase.id} className="flex items-center flex-shrink-0">
                              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 min-w-[180px]">
                                <div className="flex items-center gap-2 mb-2">
                                  <div 
                                    className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white"
                                    style={{ backgroundColor: status?.color || '#6B7280' }}
                                  >
                                    {index + 1}
                                  </div>
                                  <span className="font-medium text-slate-800 text-sm truncate">
                                    {phase.name}
                                  </span>
                                </div>
                                
                                {status && (
                                  <span 
                                    className="inline-block text-xs px-2 py-0.5 rounded-full text-white mb-2"
                                    style={{ backgroundColor: status.color }}
                                  >
                                    {status.name}
                                  </span>
                                )}
                                
                                <div className="text-xs text-slate-500">
                                  {phase.activities?.length || 0} activități
                                </div>
                                
                                {phase.activities && phase.activities.length > 0 && (
                                  <div className="mt-2 space-y-1">
                                    {phase.activities.slice(0, 3).map((act) => (
                                      <div key={act.id} className="text-xs text-slate-600 flex items-center gap-1 truncate">
                                        <Activity className="w-3 h-3 text-slate-400 flex-shrink-0" />
                                        <span className="truncate">{act.name}</span>
                                      </div>
                                    ))}
                                    {phase.activities.length > 3 && (
                                      <div className="text-xs text-slate-400">
                                        +{phase.activities.length - 3} mai multe
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                              
                              {index < (template.phases?.length || 0) - 1 && (
                                <ChevronRight className="w-4 h-4 text-slate-300 mx-1 flex-shrink-0" />
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}