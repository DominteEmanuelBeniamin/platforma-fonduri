/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react-hooks/exhaustive-deps */
'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useParams, useRouter } from 'next/navigation'
import { 
  FolderOpen, 
  Calendar, 
  Mail, 
  TrendingUp, 
  Clock,
  Building2,
  ArrowLeft,
  AlertCircle
} from 'lucide-react'

// Componente
import TeamManager from '@/components/TeamManager'
import DocumentRequests from '@/components/DocumentRequests'

export default function ProjectDetailsPage() {
  const router = useRouter()
  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      
      if (!session) {
        // Dacă nu e logat, îl trimitem la Login
        router.push('/login')
      } 
    }
    
    checkAuth()
  }, [router])

  const params = useParams()
  const projectId = params?.id as string
  const [project, setProject] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  const fetchProjectDetails = async () => {
    if (!projectId) return
    
    const { data, error } = await supabase
      .from('projects')
      .select('*, profiles(*)')
      .eq('id', projectId)
      .single()
    
    if (error) {
      console.error('Eroare:', error)
    } else {
      setProject(data)
    }
    setLoading(false)
  }

  useEffect(() => { 
    fetchProjectDetails() 
  }, [projectId])

  if (loading) {
    return (
      <div className="flex h-[70vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 border-4 border-slate-100 border-t-indigo-600 rounded-full animate-spin"></div>
          <p className="text-sm text-slate-500 font-medium">Se încarcă proiectul...</p>
        </div>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="flex h-[70vh] items-center justify-center">
        <div className="text-center max-w-md">
          <div className="w-20 h-20 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-10 h-10 text-red-500" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Proiect inexistent</h2>
          <p className="text-slate-500 mb-6">Nu am putut găsi proiectul solicitat. Verifică dacă ID-ul este corect.</p>
          <button
            onClick={() => router.push('/')}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Înapoi la Dashboard
          </button>
        </div>
      </div>
    )
  }

  // Status configuration with modern colors
  const statusConfig: Record<string, { 
    bg: string
    text: string
    border: string
    label: string
    icon: JSX.Element
  }> = {
    contractare: { 
      bg: 'bg-amber-50', 
      text: 'text-amber-700', 
      border: 'border-amber-200',
      label: 'În Contractare',
      icon: <Clock className="w-3.5 h-3.5" />
    },
    implementare: { 
      bg: 'bg-indigo-50', 
      text: 'text-indigo-700', 
      border: 'border-indigo-200',
      label: 'În Implementare',
      icon: <TrendingUp className="w-3.5 h-3.5" />
    },
    monitorizare: { 
      bg: 'bg-emerald-50', 
      text: 'text-emerald-700', 
      border: 'border-emerald-200',
      label: 'Monitorizare',
      icon: <FolderOpen className="w-3.5 h-3.5" />
    }
  }

  const currentStatus = statusConfig[project.status] || {
    bg: 'bg-slate-50',
    text: 'text-slate-700',
    border: 'border-slate-200',
    label: project.status,
    icon: <FolderOpen className="w-3.5 h-3.5" />
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 fade-in-up">
      
      {/* BREADCRUMB & BACK BUTTON */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push('/')}
          className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900 transition-colors group"
        >
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
          <span className="font-medium">Proiecte</span>
        </button>
        <span className="text-slate-300">/</span>
        <span className="text-sm font-medium text-slate-900">{project.title}</span>
      </div>

      {/* HEADER SECTION - Modern & Clean */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-8">
          
          {/* Status Badge & Progress */}
          <div className="flex items-center justify-between mb-6">
            <div className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border text-xs font-semibold uppercase tracking-wider ${currentStatus.bg} ${currentStatus.border} ${currentStatus.text}`}>
              {currentStatus.icon}
              {currentStatus.label}
            </div>
            
            {project.progress > 0 && (
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-slate-500">Progres</span>
                <div className="flex items-center gap-2">
                  <div className="w-32 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-indigo-600 to-indigo-500 rounded-full transition-all duration-700"
                      style={{ width: `${project.progress}%` }}
                    />
                  </div>
                  <span className="text-sm font-bold text-slate-900 min-w-[3ch]">{project.progress}%</span>
                </div>
              </div>
            )}
          </div>

          {/* Project Title */}
          <h1 className="text-3xl md:text-4xl font-bold text-slate-900 tracking-tight mb-3">
            {project.title}
          </h1>

          {/* Client Info Row */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <div className="flex items-center gap-2 text-slate-600">
              <Building2 className="w-4 h-4 text-slate-400" />
              <span className="font-medium text-slate-900">{project.profiles?.full_name || 'Nedefinit'}</span>
            </div>
            
            {project.profiles?.cui_firma && (
              <>
                <span className="text-slate-300">•</span>
                <div className="flex items-center gap-2 text-slate-500">
                  <span className="text-xs font-medium">CUI:</span>
                  <span className="font-mono text-slate-900">{project.profiles.cui_firma}</span>
                </div>
              </>
            )}

            <span className="text-slate-300">•</span>
            <div className="flex items-center gap-2 text-slate-500">
              <Calendar className="w-4 h-4 text-slate-400" />
              <span>{new Date(project.created_at).toLocaleDateString('ro-RO', { 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
              })}</span>
            </div>
          </div>
        </div>
      </div>

      {/* MAIN GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* SIDEBAR - Project Details */}
        <div className="lg:col-span-1 space-y-6">
          
          {/* Quick Info Card */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <FolderOpen className="w-4 h-4 text-slate-500" />
                Informații Proiect
              </h3>
            </div>
            
            <div className="p-6 space-y-5">
              {/* Status Detail */}
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-slate-50 flex items-center justify-center flex-shrink-0">
                  <TrendingUp className="w-5 h-5 text-slate-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Status Curent</p>
                  <p className="font-semibold text-slate-900 capitalize">{project.status}</p>
                </div>
              </div>

              {/* Creation Date */}
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-slate-50 flex items-center justify-center flex-shrink-0">
                  <Calendar className="w-5 h-5 text-slate-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Data Creării</p>
                  <p className="font-semibold text-slate-900">
                    {new Date(project.created_at).toLocaleDateString('ro-RO')}
                  </p>
                </div>
              </div>

              {/* Client Contact */}
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-slate-50 flex items-center justify-center flex-shrink-0">
                  <Mail className="w-5 h-5 text-slate-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Contact Client</p>
                  <p className="font-medium text-slate-900 truncate text-sm">
                    {project.profiles?.email || 'Lipsește'}
                  </p>
                </div>
              </div>

              {/* Progress Detail */}
              {project.progress > 0 && (
                <div className="pt-5 border-t border-slate-100">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Progres Dosar</span>
                    <span className="text-lg font-bold text-slate-900">{project.progress}%</span>
                  </div>
                  <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-indigo-600 to-indigo-500 rounded-full transition-all duration-700 relative overflow-hidden"
                      style={{ width: `${project.progress}%` }}
                    >
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-pulse" />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Team Manager Component */}
          <TeamManager projectId={projectId} />
        </div>

        {/* MAIN CONTENT - Documents */}
        <div className="lg:col-span-2">
          <DocumentRequests projectId={projectId} />
        </div>

      </div>
    </div>
  )
}