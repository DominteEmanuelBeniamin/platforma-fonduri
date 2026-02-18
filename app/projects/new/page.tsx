/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { 
  FolderPlus, Building2, FileText, ArrowLeft, AlertCircle,
  Layers, Plus, Trash2, ChevronDown, ChevronRight, Activity,
  Check, X, Paperclip, Upload, Loader2
} from 'lucide-react'
import { useAuth } from '@/app/providers/AuthProvider'

interface ClientProfile {
  id: string
  full_name?: string | null
  email?: string | null
  cif?: string | null
}

interface ProjectStatus {
  id: string
  name: string
  slug: string
  color: string
}

interface TemplateData {
  id: string
  name: string
  description: string | null
  phases: {
    id: string
    name: string
    project_status_id: string
    order_index: number
    activities?: {
      id: string
      name: string
      order_index: number
      document_requirements?: { id: string; name: string; is_mandatory: boolean }[]
    }[]
  }[]
}

interface ManualDocumentRequest {
  id: string
  name: string
  description: string
  is_mandatory: boolean
  templateFile: File | null
  templateFileName: string | null
}

interface ManualActivity {
  id: string
  name: string
  documentRequests: ManualDocumentRequest[]
  expanded?: boolean
}

interface ManualPhase {
  id: string
  name: string
  project_status_id: string
  activities: ManualActivity[]
  expanded?: boolean
}

function generateId() {
  return Math.random().toString(36).substring(2, 11)
}

export default function NewProjectPage() {
  const { apiFetch } = useAuth()
  const router = useRouter()

  const [clients, setClients] = useState<ClientProfile[]>([])
  const [title, setTitle] = useState('')
  const [selectedClientId, setSelectedClientId] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingClients, setLoadingClients] = useState(true)

  const [creationMode, setCreationMode] = useState<'template' | 'manual' | null>(null)
  
  const [templates, setTemplates] = useState<TemplateData[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [loadingTemplates, setLoadingTemplates] = useState(true)

  const [statuses, setStatuses] = useState<ProjectStatus[]>([])
  const [manualPhases, setManualPhases] = useState<ManualPhase[]>([])

  // Pentru adding document modal
  const [addingDocToActivity, setAddingDocToActivity] = useState<{phaseId: string, activityId: string} | null>(null)
  const [newDocName, setNewDocName] = useState('')
  const [newDocDescription, setNewDocDescription] = useState('')
  const [newDocMandatory, setNewDocMandatory] = useState(false)
  const [newDocTemplate, setNewDocTemplate] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const fetchClients = async () => {
      try {
        const res = await apiFetch('/api/clients')
        const json = await res.json()
        if (res.ok) setClients(json.clients || [])
      } catch (error) {
        console.error('Eroare clienți:', error)
      } finally {
        setLoadingClients(false)
      }
    }
    fetchClients()
  }, [apiFetch])

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [templatesRes, statusesRes] = await Promise.all([
          apiFetch('/api/admin/templates'),
          apiFetch('/api/admin/statuses')
        ])
        if (templatesRes.ok) {
          const data = await templatesRes.json()
          setTemplates(data.templates || [])
        }
        if (statusesRes.ok) {
          const data = await statusesRes.json()
          setStatuses(data.statuses || [])
        }
      } catch (error) {
        console.error('Eroare:', error)
      } finally {
        setLoadingTemplates(false)
      }
    }
    fetchData()
  }, [apiFetch])

  // Phase functions
  const addPhase = () => {
    setManualPhases([...manualPhases, {
      id: generateId(),
      name: '',
      project_status_id: statuses[0]?.id || '',
      activities: [],
      expanded: true
    }])
  }

  const updatePhase = (phaseId: string, updates: Partial<ManualPhase>) => {
    setManualPhases(manualPhases.map(p => p.id === phaseId ? { ...p, ...updates } : p))
  }

  const removePhase = (phaseId: string) => {
    setManualPhases(manualPhases.filter(p => p.id !== phaseId))
  }

  // Activity functions
  const addActivity = (phaseId: string) => {
    setManualPhases(manualPhases.map(p => 
      p.id === phaseId 
        ? { ...p, activities: [...p.activities, { id: generateId(), name: '', documentRequests: [], expanded: true }] }
        : p
    ))
  }

  const updateActivity = (phaseId: string, activityId: string, updates: Partial<ManualActivity>) => {
    setManualPhases(manualPhases.map(p => 
      p.id === phaseId 
        ? { ...p, activities: p.activities.map(a => a.id === activityId ? { ...a, ...updates } : a) }
        : p
    ))
  }

  const removeActivity = (phaseId: string, activityId: string) => {
    setManualPhases(manualPhases.map(p => 
      p.id === phaseId 
        ? { ...p, activities: p.activities.filter(a => a.id !== activityId) }
        : p
    ))
  }

  // Document request functions
  const openAddDocModal = (phaseId: string, activityId: string) => {
    setAddingDocToActivity({ phaseId, activityId })
    setNewDocName('')
    setNewDocDescription('')
    setNewDocMandatory(false)
    setNewDocTemplate(null)
  }

  const closeAddDocModal = () => {
    setAddingDocToActivity(null)
    setNewDocName('')
    setNewDocDescription('')
    setNewDocMandatory(false)
    setNewDocTemplate(null)
  }

  const confirmAddDoc = () => {
    if (!addingDocToActivity || !newDocName.trim()) return
    
    const { phaseId, activityId } = addingDocToActivity
    const newDoc: ManualDocumentRequest = {
      id: generateId(),
      name: newDocName.trim(),
      description: newDocDescription.trim(),
      is_mandatory: newDocMandatory,
      templateFile: newDocTemplate,
      templateFileName: newDocTemplate?.name || null
    }

    setManualPhases(manualPhases.map(p => 
      p.id === phaseId 
        ? { 
            ...p, 
            activities: p.activities.map(a => 
              a.id === activityId 
                ? { ...a, documentRequests: [...a.documentRequests, newDoc] }
                : a
            ) 
          }
        : p
    ))
    closeAddDocModal()
  }

  const removeDocRequest = (phaseId: string, activityId: string, docId: string) => {
    setManualPhases(manualPhases.map(p => 
      p.id === phaseId 
        ? { 
            ...p, 
            activities: p.activities.map(a => 
              a.id === activityId 
                ? { ...a, documentRequests: a.documentRequests.filter(d => d.id !== docId) }
                : a
            ) 
          }
        : p
    ))
  }

  const getStatusColor = (statusId: string) => statuses.find(s => s.id === statusId)?.color || '#6B7280'

  // Upload template helper - folosește API-ul existent
  const uploadTemplate = async (projectId: string, file: File): Promise<string | null> => {
    try {
      // 1. Init upload
      const initRes = await apiFetch(`/api/projects/${projectId}/document-requests/attachment/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: file.name,
          type: file.type
        })
      })
      
      if (!initRes.ok) {
        console.error('Init upload failed')
        return null
      }
      
      const initData = await initRes.json()
      
      // 2. Upload to storage cu signed URL
      const uploadRes = await fetch(initData.signedUploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': file.type,
          'Authorization': `Bearer ${initData.token}`
        },
        body: file
      })
      
      if (!uploadRes.ok) {
        console.error('Upload to storage failed')
        return null
      }
      
      return initData.storagePath
    } catch (error) {
      console.error('Upload template error:', error)
      return null
    }
  }

  // Create project
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      // 1. Creează proiectul
      const projectRes = await apiFetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, client_id: selectedClientId })
      })

      const projectData = await projectRes.json()
      if (!projectRes.ok) throw new Error(projectData?.error || 'Eroare la creare proiect')

      const projectId = projectData.project?.id

      // 2. Import template
      if (creationMode === 'template' && selectedTemplateId) {
        const importRes = await apiFetch(`/api/projects/${projectId}/import-template`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ template_id: selectedTemplateId })
        })
        if (!importRes.ok) console.error('Eroare import template')
      }
      
      // 3. Creare manuală cu document requests
      if (creationMode === 'manual' && manualPhases.length > 0) {
        for (let pIdx = 0; pIdx < manualPhases.length; pIdx++) {
          const phase = manualPhases[pIdx]
          if (!phase.name.trim()) continue

          // Crează faza
          const phaseRes = await apiFetch(`/api/projects/${projectId}/phases`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: phase.name,
              project_status_id: phase.project_status_id,
              order_index: pIdx + 1,
              status: pIdx === 0 ? 'in_progress' : 'pending'
            })
          })

          if (!phaseRes.ok) continue
          const phaseData = await phaseRes.json()
          const newPhaseId = phaseData.phase?.id

          // Crează activitățile
          for (let aIdx = 0; aIdx < phase.activities.length; aIdx++) {
            const activity = phase.activities[aIdx]
            if (!activity.name.trim()) continue

            const actRes = await apiFetch(`/api/projects/${projectId}/phases/${newPhaseId}/activities`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: activity.name,
                order_index: aIdx + 1,
                status: 'pending'
              })
            })

            if (!actRes.ok) continue
            const actData = await actRes.json()
            const newActivityId = actData.activity?.id

            // Crează document requests pentru fiecare document
            for (const docReq of activity.documentRequests) {
              // Uploadează template dacă există
              let attachmentPath: string | null = null
              if (docReq.templateFile) {
                attachmentPath = await uploadTemplate(projectId, docReq.templateFile)
              }

              // Creează cererea de document folosind API-ul existent
              await apiFetch(`/api/projects/${projectId}/document-requests`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  name: docReq.name,
                  description: docReq.description || null,
                  is_mandatory: docReq.is_mandatory,
                  activity_id: newActivityId,
                  attachment_path: attachmentPath
                })
              })
            }
          }
        }

        // Setează statusul proiectului
        if (manualPhases[0]?.project_status_id) {
          await apiFetch(`/api/projects/${projectId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ current_status_id: manualPhases[0].project_status_id })
          })
        }
      }

      router.push(`/projects/${projectId}`)
    } catch (err: any) {
      alert('Eroare: ' + (err?.message || 'Unknown error'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50/50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        
        {/* Breadcrumb */}
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/')} className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900 group">
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
            <span className="font-medium">Proiecte</span>
          </button>
          <span className="text-slate-300">/</span>
          <span className="text-sm font-medium text-slate-900">Dosar Nou</span>
        </div>

        {/* Header */}
        <div className="text-center space-y-3">
          <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight">Deschide Dosar Nou</h1>
          <p className="text-slate-500 text-sm sm:text-base max-w-md mx-auto">Completează informațiile pentru a crea un nou proiect</p>
        </div>

        <form onSubmit={handleCreate} className="space-y-6">
          {/* Card: Informații de bază */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-100">
              <h2 className="font-semibold text-slate-900">Informații proiect</h2>
            </div>
            <div className="p-6 space-y-4">
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <FileText className="w-4 h-4 text-slate-500" />
                  Nume Proiect *
                </label>
                <input 
                  type="text" 
                  placeholder="Ex: Digitalizare IMM - Firma X"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <Building2 className="w-4 h-4 text-slate-500" />
                  Beneficiar (Client) *
                </label>
                {loadingClients ? (
                  <div className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center gap-2 text-slate-400">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm">Se încarcă...</span>
                  </div>
                ) : (
                  <select 
                    value={selectedClientId} 
                    onChange={(e) => setSelectedClientId(e.target.value)}
                    required
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">Alege beneficiarul</option>
                    {clients.map(client => (
                      <option key={client.id} value={client.id}>
                        {client.full_name || client.email} {client.cif ? `(CIF: ${client.cif})` : ''}
                      </option>
                    ))}
                  </select>
                )}
                {clients.length === 0 && !loadingClients && (
                  <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0" />
                    <p className="text-sm text-amber-900">Nu există clienți.</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Card: Mod creare */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-100">
              <h2 className="font-semibold text-slate-900">Structură proiect</h2>
            </div>
            <div className="p-6">
              {/* Selectare mod */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <button type="button" onClick={() => { setCreationMode(null); setSelectedTemplateId(null); setManualPhases([]) }}
                  className={`p-4 rounded-xl border-2 text-left transition-all ${creationMode === null ? 'border-slate-400 bg-slate-50' : 'border-slate-200 hover:border-slate-300'}`}>
                  <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center mb-3">
                    <FolderPlus className="w-5 h-5 text-slate-600" />
                  </div>
                  <p className="font-medium text-slate-900">Proiect gol</p>
                  <p className="text-xs text-slate-500 mt-1">Fără faze predefinite</p>
                </button>

                <button type="button" onClick={() => { setCreationMode('template'); setManualPhases([]) }}
                  className={`p-4 rounded-xl border-2 text-left transition-all ${creationMode === 'template' ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 hover:border-slate-300'}`}>
                  <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center mb-3">
                    <Layers className="w-5 h-5 text-indigo-600" />
                  </div>
                  <p className="font-medium text-slate-900">Din template</p>
                  <p className="text-xs text-slate-500 mt-1">Importă faze predefinite</p>
                </button>

                <button type="button" onClick={() => { setCreationMode('manual'); setSelectedTemplateId(null) }}
                  className={`p-4 rounded-xl border-2 text-left transition-all ${creationMode === 'manual' ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 hover:border-slate-300'}`}>
                  <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center mb-3">
                    <Plus className="w-5 h-5 text-emerald-600" />
                  </div>
                  <p className="font-medium text-slate-900">Creare manuală</p>
                  <p className="text-xs text-slate-500 mt-1">Definește fazele acum</p>
                </button>
              </div>

              {/* Template selection */}
              {creationMode === 'template' && (
                <div className="space-y-3">
                  {loadingTemplates ? (
                    <div className="text-center py-8 text-slate-500">Se încarcă template-urile...</div>
                  ) : templates.length === 0 ? (
                    <div className="text-center py-8">
                      <Layers className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                      <p className="text-slate-500">Nu există template-uri.</p>
                    </div>
                  ) : (
                    templates.map(template => (
                      <button key={template.id} type="button" onClick={() => setSelectedTemplateId(template.id)}
                        className={`w-full p-4 rounded-xl border-2 text-left transition-all ${selectedTemplateId === template.id ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 hover:border-slate-300'}`}>
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium text-slate-900">{template.name}</p>
                            {template.description && <p className="text-xs text-slate-500">{template.description}</p>}
                          </div>
                          <span className="text-xs text-slate-500">{template.phases?.length || 0} faze</span>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}

              {/* Manual creation */}
              {creationMode === 'manual' && (
                <div className="space-y-4">
                  {manualPhases.map((phase, phaseIdx) => (
                    <div key={phase.id} className="border border-slate-200 rounded-xl overflow-hidden">
                      {/* Phase header */}
                      <div className="px-4 py-3 bg-slate-50 flex items-center gap-3">
                        <button type="button" onClick={() => updatePhase(phase.id, { expanded: !phase.expanded })} className="text-slate-400">
                          {phase.expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ backgroundColor: getStatusColor(phase.project_status_id) }}>
                          {phaseIdx + 1}
                        </div>
                        <input type="text" value={phase.name} onChange={(e) => updatePhase(phase.id, { name: e.target.value })}
                          placeholder="Nume fază..." className="flex-1 px-3 py-1.5 border border-slate-200 rounded-lg text-sm" />
                        <select value={phase.project_status_id} onChange={(e) => updatePhase(phase.id, { project_status_id: e.target.value })}
                          className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm">
                          {statuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                        <button type="button" onClick={() => removePhase(phase.id)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      {/* Phase content */}
                      {phase.expanded && (
                        <div className="p-4 space-y-3">
                          {phase.activities.map((activity) => (
                            <div key={activity.id} className="pl-4 border-l-2 border-slate-200">
                              <div className="flex items-center gap-2 mb-2">
                                <Activity className="w-4 h-4 text-slate-400" />
                                <input type="text" value={activity.name} onChange={(e) => updateActivity(phase.id, activity.id, { name: e.target.value })}
                                  placeholder="Nume activitate..." className="flex-1 px-3 py-1.5 border border-slate-200 rounded-lg text-sm" />
                                <button type="button" onClick={() => updateActivity(phase.id, activity.id, { expanded: !activity.expanded })} className="p-1 text-slate-400">
                                  {activity.expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                </button>
                                <button type="button" onClick={() => removeActivity(phase.id, activity.id)} className="p-1 text-slate-400 hover:text-red-500">
                                  <X className="w-4 h-4" />
                                </button>
                              </div>

                              {/* Document Requests */}
                              {activity.expanded && (
                                <div className="ml-6 space-y-2">
                                  {activity.documentRequests.map(doc => (
                                    <div key={doc.id} className="flex items-start gap-2 p-3 bg-slate-50 rounded-lg border border-slate-100">
                                      <FileText className="w-4 h-4 text-slate-400 mt-0.5" />
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <span className="font-medium text-sm text-slate-900">{doc.name}</span>
                                          {doc.is_mandatory && <span className="text-xs px-1.5 py-0.5 bg-red-100 text-red-600 rounded">Obligatoriu</span>}
                                        </div>
                                        {doc.description && <p className="text-xs text-slate-500 mt-0.5">{doc.description}</p>}
                                        {doc.templateFileName && (
                                          <div className="flex items-center gap-1 mt-1 text-xs text-indigo-600">
                                            <Paperclip className="w-3 h-3" />
                                            <span>{doc.templateFileName}</span>
                                          </div>
                                        )}
                                      </div>
                                      <button type="button" onClick={() => removeDocRequest(phase.id, activity.id, doc.id)} className="p-1 text-slate-400 hover:text-red-500">
                                        <X className="w-4 h-4" />
                                      </button>
                                    </div>
                                  ))}
                                  <button type="button" onClick={() => openAddDocModal(phase.id, activity.id)}
                                    className="flex items-center gap-1 py-2 px-3 text-xs text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 rounded-lg">
                                    <Plus className="w-3 h-3" /> Adaugă cerere document
                                  </button>
                                </div>
                              )}
                            </div>
                          ))}
                          <button type="button" onClick={() => addActivity(phase.id)} className="text-sm text-indigo-600 hover:text-indigo-700 flex items-center gap-1 ml-4">
                            <Plus className="w-4 h-4" /> Adaugă activitate
                          </button>
                        </div>
                      )}
                    </div>
                  ))}

                  <button type="button" onClick={addPhase} className="w-full py-3 border-2 border-dashed border-slate-300 rounded-xl text-slate-500 hover:border-indigo-400 hover:text-indigo-600 flex items-center justify-center gap-2">
                    <Plus className="w-5 h-5" /> Adaugă fază nouă
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Buttons */}
          <div className="flex flex-col-reverse sm:flex-row gap-3">
            <button type="button" onClick={() => router.push('/')} className="flex-1 px-5 py-3 bg-white border border-slate-200 text-slate-700 rounded-lg text-sm font-semibold hover:bg-slate-50">
              Anulează
            </button>
            <button type="submit" disabled={loading || !title || !selectedClientId}
              className="flex-1 px-5 py-3 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Se creează...
                </>
              ) : (
                <>
                  <FolderPlus className="w-4 h-4" />
                  Creează Proiect
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Modal pentru adăugare cerere document */}
      {addingDocToActivity && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-semibold text-slate-900">Adaugă cerere document</h3>
              <button onClick={closeAddDocModal} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nume document *</label>
                <input type="text" value={newDocName} onChange={(e) => setNewDocName(e.target.value)}
                  placeholder="Ex: Certificat constatator" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Descriere</label>
                <textarea value={newDocDescription} onChange={(e) => setNewDocDescription(e.target.value)}
                  placeholder="Instrucțiuni pentru client..." rows={3} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none" />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Model / Template (opțional)</label>
                {newDocTemplate ? (
                  <div className="flex items-center gap-3 p-3 bg-indigo-50 border border-indigo-200 rounded-lg">
                    <Paperclip className="w-5 h-5 text-indigo-600 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-indigo-900 truncate">{newDocTemplate.name}</p>
                      <p className="text-xs text-indigo-600">{(newDocTemplate.size / 1024).toFixed(1)} KB</p>
                    </div>
                    <button type="button" onClick={() => setNewDocTemplate(null)} className="p-1 text-indigo-600 hover:text-indigo-800">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed border-slate-200 rounded-xl cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/50 transition-colors">
                    <Upload className="w-8 h-8 text-slate-400" />
                    <span className="text-sm text-slate-600 font-medium">Click pentru a încărca</span>
                    <span className="text-xs text-slate-400">PDF, DOC, DOCX, XLS, XLSX</span>
                    <input ref={fileInputRef} type="file" onChange={(e) => setNewDocTemplate(e.target.files?.[0] || null)} className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx" />
                  </label>
                )}
              </div>

              <label className="flex items-center gap-2">
                <input type="checkbox" checked={newDocMandatory} onChange={(e) => setNewDocMandatory(e.target.checked)} className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                <span className="text-sm text-slate-700">Document obligatoriu</span>
              </label>
            </div>

            <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex gap-3">
              <button type="button" onClick={closeAddDocModal} className="flex-1 px-4 py-2.5 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-white">
                Anulează
              </button>
              <button type="button" onClick={confirmAddDoc} disabled={!newDocName.trim()}
                className="flex-1 px-4 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2">
                <Check className="w-4 h-4" /> Adaugă
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}