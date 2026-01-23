/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react-hooks/exhaustive-deps */
'use client'
import { JSX, useEffect, useState } from 'react'
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
  
    const {
      data: { session }
    } = await supabase.auth.getSession()
  
    if (!session) {
      router.push('/login')
      return
    }
  
    const response = await fetch(`/api/projects/${projectId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${session.access_token}`
      }
    })
  
    const result = await response.json()
  
    if (!response.ok) {
      console.error('Eroare:', result?.error)
      setLoading(false)
      return
    }
  
    setProject(result.project)
    setLoading(false)
  }
  

  useEffect(() => { 
    fetchProjectDetails() 
  }, [projectId])

  if (loading) {
    return (
      <div className="flex h-[70vh] items-center justify-center px-4">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 border-4 border-slate-100 border-t-indigo-600 rounded-full animate-spin"></div>
          <p className="text-sm text-slate-500 font-medium">Se încarcă proiectul...</p>
        </div>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="flex h-[70vh] items-center justify-center px-4">
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
    dotColor: string
    label: string
    icon: JSX.Element
  }> = {
    contractare: { 
      bg: 'bg-amber-50', 
      text: 'text-amber-700',
      dotColor: 'bg-amber-500',
      label: 'În Contractare',
      icon: <Clock className="w-4 h-4" />
    },
    implementare: { 
      bg: 'bg-blue-50', 
      text: 'text-blue-700',
      dotColor: 'bg-blue-500',
      label: 'În Implementare',
      icon: <TrendingUp className="w-4 h-4" />
    },
    monitorizare: { 
      bg: 'bg-emerald-50', 
      text: 'text-emerald-700',
      dotColor: 'bg-emerald-500',
      label: 'Monitorizare',
      icon: <FolderOpen className="w-4 h-4" />
    }
  }

  const currentStatus = statusConfig[project.status] || {
    bg: 'bg-slate-50',
    text: 'text-slate-700',
    dotColor: 'bg-slate-500',
    label: project.status,
    icon: <FolderOpen className="w-4 h-4" />
  }

  return (
    <div className="min-h-screen bg-slate-50/50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6 fade-in-up">
        
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
          <span className="text-sm font-medium text-slate-900 truncate">{project.title}</span>
        </div>

        {/* HEADER SECTION - Redesigned */}
        <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-6 sm:p-8">
            
            {/* Status Badge - Redesigned More Subtle */}
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
              <div className="flex items-center gap-3">
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${currentStatus.bg} ${currentStatus.text}`}>
                  <span className={`w-2 h-2 rounded-full ${currentStatus.dotColor} animate-pulse`}></span>
                  <span className="text-xs font-semibold">{currentStatus.label}</span>
                </div>
              </div>
              
              {/* Progress Bar */}
              {project.progress > 0 && (
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-slate-500 whitespace-nowrap">Progres</span>
                  <div className="flex items-center gap-2">
                    <div className="w-full sm:w-32 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-gradient-to-r from-indigo-600 to-indigo-500 rounded-full transition-all duration-700"
                        style={{ width: `${project.progress}%` }}
                      />
                    </div>
                    <span className="text-sm font-bold text-slate-900 min-w-[3ch] whitespace-nowrap">{project.progress}%</span>
                  </div>
                </div>
              )}
            </div>

            {/* Project Title & Metadata */}
            <div className="space-y-4">
              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-slate-900 tracking-tight break-words">
                {project.title}
              </h1>

              {/* Client Info Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-2">
                {/* Client Name */}
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                    <Building2 className="w-4 h-4 text-slate-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-slate-500 font-medium">Client</p>
                    <p className="text-sm font-semibold text-slate-900 truncate">{project.profiles?.full_name || 'Nedefinit'}</p>
                  </div>
                </div>

                {/* CUI */}
                {project.profiles?.cui_firma && (
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-bold text-slate-600">CUI</span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-slate-500 font-medium">Cod Unic</p>
                      <p className="text-sm font-semibold text-slate-900 font-mono">{project.profiles.cui_firma}</p>
                    </div>
                  </div>
                )}

                {/* Creation Date */}
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                    <Calendar className="w-4 h-4 text-slate-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-slate-500 font-medium">Data creării</p>
                    <p className="text-sm font-semibold text-slate-900">
                      {new Date(project.created_at).toLocaleDateString('ro-RO', { 
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric'
                      })}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* MAIN GRID - Better Mobile Stacking */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          
          {/* SIDEBAR - Project Details */}
          <div className="lg:col-span-1 space-y-4 sm:space-y-6">
            
            {/* Quick Info Card */}
            <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-100 bg-slate-50/50">
                <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <FolderOpen className="w-4 h-4 text-slate-500" />
                  Informații Proiect
                </h3>
              </div>
              
              <div className="p-4 sm:p-6 space-y-4 sm:space-y-5">
                {/* Status Detail */}
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-slate-50 flex items-center justify-center flex-shrink-0">
                    <TrendingUp className="w-5 h-5 text-slate-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Status Curent</p>
                    <p className="font-semibold text-slate-900 capitalize break-words">{currentStatus.label}</p>
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
                    <p className="font-medium text-slate-900 truncate text-sm break-all">
                      {project.profiles?.email || 'Lipsește'}
                    </p>
                  </div>
                </div>

                {/* Progress Detail */}
                {project.progress > 0 && (
                  <div className="pt-4 sm:pt-5 border-t border-slate-100">
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
    </div>
  )
}