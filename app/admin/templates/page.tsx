/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { 
  Layers, Activity, FileText, ArrowLeft, Plus, Trash2,
  ChevronDown, ChevronRight, Check, X, Paperclip, Upload,
  Loader2, Edit2
} from 'lucide-react'
import { useAuth } from '@/app/providers/AuthProvider'

interface ProjectStatus {
  id: string
  name: string
  slug: string
  color: string
}

interface DocumentRequirement {
  id: string
  name: string
  description: string
  is_mandatory: boolean
  templateFile: File | null
  templateFileName: string | null
}

interface TemplateActivity {
  id: string
  name: string
  document_requirements: DocumentRequirement[]
  expanded: boolean
}

interface TemplatePhase {
  id: string
  name: string
  project_status_id: string
  activities: TemplateActivity[]
  expanded: boolean
}

interface Template {
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
      document_requirements?: { 
        id: string
        name: string
        description: string | null
        is_mandatory: boolean
        attachment_path: string | null
      }[]
    }[]
  }[]
}

function generateId() {
  return Math.random().toString(36).substring(2, 11)
}

function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || generateId()
}

// IDs din DB sunt UUID (36 chars cu cratime), cele locale sunt scurte
function isDbId(id: string): boolean {
  return id.length === 36 && id.includes('-')
}

export default function AdminTemplatesPage() {
  const router = useRouter()
  const { loading: authLoading, token, apiFetch, profile } = useAuth()

  const [templates, setTemplates] = useState<Template[]>([])
  const [statuses, setStatuses] = useState<ProjectStatus[]>([])
  const [loading, setLoading] = useState(true)
  
  const [showForm, setShowForm] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null)
  
  const [templateName, setTemplateName] = useState('')
  const [templateDescription, setTemplateDescription] = useState('')
  const [phases, setPhases] = useState<TemplatePhase[]>([])
  const [saving, setSaving] = useState(false)

  const [addingDocTo, setAddingDocTo] = useState<{ phaseId: string, activityId: string } | null>(null)
  const [newDocName, setNewDocName] = useState('')
  const [newDocDescription, setNewDocDescription] = useState('')
  const [newDocMandatory, setNewDocMandatory] = useState(false)
  const [newDocTemplate, setNewDocTemplate] = useState<File | null>(null)

  useEffect(() => {
    if (authLoading) return
    if (!token) { router.replace('/login'); return }
    if (profile && profile.role !== 'admin') { router.replace('/'); return }
    fetchData()
  }, [authLoading, token, profile, router])

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
      setLoading(false)
    }
  }

  const addPhase = () => {
    setPhases([...phases, {
      id: generateId(),
      name: '',
      project_status_id: statuses[0]?.id || '',
      activities: [],
      expanded: true
    }])
  }

  const updatePhase = (phaseId: string, updates: Partial<TemplatePhase>) => {
    setPhases(phases.map(p => p.id === phaseId ? { ...p, ...updates } : p))
  }

  const removePhase = (phaseId: string) => {
    setPhases(phases.filter(p => p.id !== phaseId))
  }

  const addActivity = (phaseId: string) => {
    setPhases(phases.map(p => 
      p.id === phaseId 
        ? { ...p, activities: [...p.activities, { id: generateId(), name: '', document_requirements: [], expanded: true }] }
        : p
    ))
  }

  const updateActivity = (phaseId: string, activityId: string, updates: Partial<TemplateActivity>) => {
    setPhases(phases.map(p => 
      p.id === phaseId 
        ? { ...p, activities: p.activities.map(a => a.id === activityId ? { ...a, ...updates } : a) }
        : p
    ))
  }

  const removeActivity = (phaseId: string, activityId: string) => {
    setPhases(phases.map(p => 
      p.id === phaseId 
        ? { ...p, activities: p.activities.filter(a => a.id !== activityId) }
        : p
    ))
  }

  const openAddDocModal = (phaseId: string, activityId: string) => {
    setAddingDocTo({ phaseId, activityId })
    setNewDocName('')
    setNewDocDescription('')
    setNewDocMandatory(false)
    setNewDocTemplate(null)
  }

  const closeDocModal = () => {
    setAddingDocTo(null)
    setNewDocName('')
    setNewDocDescription('')
    setNewDocMandatory(false)
    setNewDocTemplate(null)
  }

  const confirmAddDoc = () => {
    if (!addingDocTo || !newDocName.trim()) return
    const { phaseId, activityId } = addingDocTo
    const newDoc: DocumentRequirement = {
      id: generateId(),
      name: newDocName.trim(),
      description: newDocDescription.trim(),
      is_mandatory: newDocMandatory,
      templateFile: newDocTemplate,
      templateFileName: newDocTemplate?.name || null
    }
    setPhases(phases.map(p => 
      p.id === phaseId 
        ? { ...p, activities: p.activities.map(a => 
            a.id === activityId 
              ? { ...a, document_requirements: [...a.document_requirements, newDoc] }
              : a
          )} 
        : p
    ))
    closeDocModal()
  }

  const removeDocRequirement = (phaseId: string, activityId: string, docId: string) => {
    setPhases(phases.map(p => 
      p.id === phaseId 
        ? { ...p, activities: p.activities.map(a => 
            a.id === activityId 
              ? { ...a, document_requirements: a.document_requirements.filter(d => d.id !== docId) }
              : a
          )} 
        : p
    ))
  }

  const getStatusColor = (statusId: string) => statuses.find(s => s.id === statusId)?.color || '#6B7280'

  const resetForm = () => {
    setTemplateName('')
    setTemplateDescription('')
    setPhases([])
    setEditingTemplate(null)
    setShowForm(false)
  }

  const uploadTemplateFile = async (file: File): Promise<string | null> => {
    try {
      const initRes = await apiFetch('/api/admin/templates/documents/attachment/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: file.name, type: file.type })
      })
      if (!initRes.ok) return null
      const initData = await initRes.json()
      const uploadRes = await fetch(initData.signedUploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type, 'Authorization': `Bearer ${initData.token}` },
        body: file
      })
      if (!uploadRes.ok) return null
      return initData.storagePath
    } catch (error) {
      console.error('Upload error:', error)
      return null
    }
  }

  const handleSave = async () => {
    if (!templateName.trim()) {
      alert('Numele template-ului este obligatoriu')
      return
    }

    setSaving(true)
    try {
      const safeParseError = async (res: Response, fallback: string) => {
        try {
          const data = await res.json()
          return data.error || data.message || fallback
        } catch {
          return `${fallback} (${res.status})`
        }
      }

      let templateId: string

      if (editingTemplate) {
        // PATCH template existent
        const res = await apiFetch(`/api/admin/templates/${editingTemplate.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: templateName.trim(),
            slug: generateSlug(templateName.trim()),
            description: templateDescription.trim() || null,
          })
        })
        if (!res.ok) throw new Error(await safeParseError(res, 'Eroare la actualizare template'))
        templateId = editingTemplate.id

        // Ștergem fazele care au fost eliminate din UI
        const existingPhaseIds = new Set(editingTemplate.phases?.map(p => p.id) || [])
        const currentPhaseIds = new Set(phases.filter(p => isDbId(p.id)).map(p => p.id))
        for (const oldId of existingPhaseIds) {
          if (!currentPhaseIds.has(oldId)) {
            await apiFetch(`/api/admin/templates/phases/${oldId}`, { method: 'DELETE' })
          }
        }
      } else {
        // POST template nou
        const res = await apiFetch('/api/admin/templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: templateName.trim(),
            slug: generateSlug(templateName.trim()),
            description: templateDescription.trim() || null,
          })
        })
        if (!res.ok) throw new Error(await safeParseError(res, 'Eroare la creare template'))
        const data = await res.json()
        templateId = data.template.id
      }

      // Salvează fazele
      for (let pIdx = 0; pIdx < phases.length; pIdx++) {
        const phase = phases[pIdx]
        let phaseId: string

        if (isDbId(phase.id)) {
          // PATCH faza existentă
          const phaseRes = await apiFetch(`/api/admin/templates/phases/${phase.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: phase.name,
              project_status_id: phase.project_status_id,
              order_index: pIdx + 1,
            })
          })
          if (!phaseRes.ok) throw new Error(await safeParseError(phaseRes, `Eroare la actualizare faza "${phase.name}"`))
          phaseId = phase.id

          // Ștergem activitățile eliminate
          const originalPhase = editingTemplate?.phases?.find(p => p.id === phase.id)
          const existingActivityIds = new Set(originalPhase?.activities?.map(a => a.id) || [])
          const currentActivityIds = new Set(phase.activities.filter(a => isDbId(a.id)).map(a => a.id))
          for (const oldId of existingActivityIds) {
            if (!currentActivityIds.has(oldId)) {
              await apiFetch(`/api/admin/templates/activities/${oldId}`, { method: 'DELETE' })
            }
          }
        } else {
          // POST faza nouă
          const phaseRes = await apiFetch('/api/admin/templates/phases', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              template_id: templateId,
              project_status_id: phase.project_status_id,
              name: phase.name,
              slug: generateSlug(phase.name) || `faza-${pIdx + 1}`,
              order_index: pIdx + 1,
            })
          })
          if (!phaseRes.ok) throw new Error(await safeParseError(phaseRes, `Eroare la salvare faza "${phase.name}"`))
          const phaseData = await phaseRes.json()
          phaseId = phaseData.phase.id
        }

        // Salvează activitățile
        for (let aIdx = 0; aIdx < phase.activities.length; aIdx++) {
          const activity = phase.activities[aIdx]
          let activityId: string

          if (isDbId(activity.id)) {
            // PATCH activitate existentă
            const actRes = await apiFetch(`/api/admin/templates/activities/${activity.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: activity.name, order_index: aIdx + 1 })
            })
            if (!actRes.ok) throw new Error(await safeParseError(actRes, `Eroare la actualizare activitate "${activity.name}"`))
            activityId = activity.id

            // Ștergem documentele eliminate
            const originalPhase = editingTemplate?.phases?.find(p => p.id === phase.id)
            const originalActivity = originalPhase?.activities?.find(a => a.id === activity.id)
            const existingDocIds = new Set(originalActivity?.document_requirements?.map(d => d.id) || [])
            const currentDocIds = new Set(activity.document_requirements.filter(d => isDbId(d.id)).map(d => d.id))
            for (const oldId of existingDocIds) {
              if (!currentDocIds.has(oldId)) {
                await apiFetch(`/api/admin/templates/documents/${oldId}`, { method: 'DELETE' })
              }
            }
          } else {
            // POST activitate nouă
            const actRes = await apiFetch('/api/admin/templates/activities', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                template_phase_id: phaseId,
                name: activity.name,
                order_index: aIdx + 1,
              })
            })
            if (!actRes.ok) throw new Error(await safeParseError(actRes, `Eroare la salvare activitate "${activity.name}"`))
            const actData = await actRes.json()
            activityId = actData.activity.id
          }

          // Salvează documentele
          for (let dIdx = 0; dIdx < activity.document_requirements.length; dIdx++) {
            const doc = activity.document_requirements[dIdx]

            if (isDbId(doc.id)) {
              // PATCH document existent
              let attachmentPath: string | undefined = undefined
              if (doc.templateFile) {
                const uploaded = await uploadTemplateFile(doc.templateFile)
                if (uploaded) attachmentPath = uploaded
              }
              const patchBody: any = {
                name: doc.name,
                description: doc.description || null,
                is_mandatory: doc.is_mandatory,
                order_index: dIdx + 1,
              }
              if (attachmentPath !== undefined) patchBody.attachment_path = attachmentPath
              await apiFetch(`/api/admin/templates/documents/${doc.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(patchBody)
              })
            } else {
              // POST document nou
              let attachmentPath = null
              if (doc.templateFile) {
                attachmentPath = await uploadTemplateFile(doc.templateFile)
              }
              const docRes = await apiFetch('/api/admin/templates/documents', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  template_activity_id: activityId,
                  name: doc.name,
                  description: doc.description || null,
                  is_mandatory: doc.is_mandatory,
                  order_index: dIdx + 1,
                  attachment_path: attachmentPath,
                })
              })
              if (!docRes.ok) throw new Error(await safeParseError(docRes, `Eroare la salvare document "${doc.name}"`))
            }
          }
        }
      }

      resetForm()
      fetchData()
    } catch (error: any) {
      alert('Eroare: ' + error.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (templateId: string) => {
    if (!confirm('Sigur vrei să ștergi acest template?')) return
    try {
      const res = await apiFetch(`/api/admin/templates/${templateId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Eroare la ștergere')
      fetchData()
    } catch (error: any) {
      alert('Eroare: ' + error.message)
    }
  }

  const handleEdit = (template: Template) => {
    setEditingTemplate(template)
    setTemplateName(template.name)
    setTemplateDescription(template.description || '')
    const editablePhases: TemplatePhase[] = template.phases?.map(p => ({
      id: p.id,
      name: p.name,
      project_status_id: p.project_status_id,
      expanded: true,
      activities: p.activities?.map(a => ({
        id: a.id,
        name: a.name,
        expanded: true,
        document_requirements: a.document_requirements?.map(d => ({
          id: d.id,
          name: d.name,
          description: d.description || '',
          is_mandatory: d.is_mandatory,
          templateFile: null,
          templateFileName: d.attachment_path ? d.attachment_path.split('/').pop() || null : null
        })) || []
      })) || []
    })) || []
    setPhases(editablePhases)
    setShowForm(true)
  }

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Link href="/admin" className="text-slate-400 hover:text-slate-600">
                <ArrowLeft className="w-5 h-5" />
              </Link>
              <h1 className="text-2xl font-bold text-slate-900">Template-uri Proiecte</h1>
            </div>
            <p className="text-slate-500">Gestionează template-urile pentru crearea rapidă de proiecte</p>
          </div>
          {!showForm && (
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700"
            >
              <Plus className="w-4 h-4" /> Template nou
            </button>
          )}
        </div>

        {/* Form */}
        {showForm && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm mb-6 overflow-hidden">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
              <h2 className="font-semibold text-slate-900">
                {editingTemplate ? 'Editează Template' : 'Template Nou'}
              </h2>
              <button onClick={resetForm} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Nume template *</label>
                  <input
                    type="text"
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                    placeholder="Ex: Proiect Standard"
                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Descriere</label>
                  <input
                    type="text"
                    value={templateDescription}
                    onChange={(e) => setTemplateDescription(e.target.value)}
                    placeholder="Descriere scurtă..."
                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>
              </div>

              {/* Faze */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-3">Faze și Activități</label>
                <div className="space-y-4">
                  {phases.map((phase, phaseIdx) => (
                    <div key={phase.id} className="border border-slate-200 rounded-xl overflow-hidden">
                      <div className="px-4 py-3 bg-slate-50 flex items-center gap-3">
                        <button onClick={() => updatePhase(phase.id, { expanded: !phase.expanded })} className="text-slate-400">
                          {phase.expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                        <div 
                          className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white"
                          style={{ backgroundColor: getStatusColor(phase.project_status_id) }}
                        >
                          {phaseIdx + 1}
                        </div>
                        <input
                          type="text"
                          value={phase.name}
                          onChange={(e) => updatePhase(phase.id, { name: e.target.value })}
                          placeholder="Nume fază..."
                          className="flex-1 px-3 py-1.5 border border-slate-200 rounded-lg text-sm"
                        />
                        <select
                          value={phase.project_status_id}
                          onChange={(e) => updatePhase(phase.id, { project_status_id: e.target.value })}
                          className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm"
                        >
                          {statuses.map(s => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </select>
                        <button onClick={() => removePhase(phase.id)} className="p-1.5 text-slate-400 hover:text-red-600">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      {phase.expanded && (
                        <div className="p-4 space-y-3">
                          {phase.activities.map((activity) => (
                            <div key={activity.id} className="pl-4 border-l-2 border-slate-200">
                              <div className="flex items-center gap-2 mb-2">
                                <Activity className="w-4 h-4 text-slate-400" />
                                <input
                                  type="text"
                                  value={activity.name}
                                  onChange={(e) => updateActivity(phase.id, activity.id, { name: e.target.value })}
                                  placeholder="Nume activitate..."
                                  className="flex-1 px-3 py-1.5 border border-slate-200 rounded-lg text-sm"
                                />
                                <button onClick={() => updateActivity(phase.id, activity.id, { expanded: !activity.expanded })} className="p-1 text-slate-400">
                                  {activity.expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                </button>
                                <button onClick={() => removeActivity(phase.id, activity.id)} className="p-1 text-slate-400 hover:text-red-500">
                                  <X className="w-4 h-4" />
                                </button>
                              </div>

                              {activity.expanded && (
                                <div className="ml-6 space-y-2">
                                  {activity.document_requirements.map(doc => (
                                    <div key={doc.id} className="flex items-start gap-2 p-3 bg-slate-50 rounded-lg border border-slate-100">
                                      <FileText className="w-4 h-4 text-slate-400 mt-0.5" />
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <span className="font-medium text-sm text-slate-900">{doc.name}</span>
                                          {doc.is_mandatory && (
                                            <span className="text-xs px-1.5 py-0.5 bg-red-100 text-red-600 rounded">Obligatoriu</span>
                                          )}
                                        </div>
                                        {doc.description && (
                                          <p className="text-xs text-slate-500 mt-0.5">{doc.description}</p>
                                        )}
                                        {doc.templateFileName && (
                                          <div className="flex items-center gap-1 mt-1 text-xs text-indigo-600">
                                            <Paperclip className="w-3 h-3" />
                                            <span>{doc.templateFileName}</span>
                                          </div>
                                        )}
                                      </div>
                                      <button onClick={() => removeDocRequirement(phase.id, activity.id, doc.id)} className="p-1 text-slate-400 hover:text-red-500">
                                        <X className="w-4 h-4" />
                                      </button>
                                    </div>
                                  ))}
                                  <button
                                    onClick={() => openAddDocModal(phase.id, activity.id)}
                                    className="flex items-center gap-1 py-2 px-3 text-xs text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 rounded-lg"
                                  >
                                    <Plus className="w-3 h-3" /> Adaugă cerere document
                                  </button>
                                </div>
                              )}
                            </div>
                          ))}
                          <button
                            onClick={() => addActivity(phase.id)}
                            className="text-sm text-indigo-600 hover:text-indigo-700 flex items-center gap-1 ml-4"
                          >
                            <Plus className="w-4 h-4" /> Adaugă activitate
                          </button>
                        </div>
                      )}
                    </div>
                  ))}

                  <button
                    onClick={addPhase}
                    className="w-full py-3 border-2 border-dashed border-slate-300 rounded-xl text-slate-500 hover:border-indigo-400 hover:text-indigo-600 flex items-center justify-center gap-2"
                  >
                    <Plus className="w-5 h-5" /> Adaugă fază nouă
                  </button>
                </div>
              </div>

              <div className="flex gap-3 pt-4 border-t border-slate-100">
                <button
                  onClick={resetForm}
                  className="flex-1 px-4 py-2.5 border border-slate-200 rounded-lg text-slate-700 font-medium hover:bg-slate-50"
                >
                  Anulează
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !templateName.trim()}
                  className="flex-1 px-4 py-2.5 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {saving ? 'Se salvează...' : (editingTemplate ? 'Salvează modificările' : 'Creează template')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Templates list */}
        {!showForm && (
          <div className="space-y-4">
            {templates.length === 0 ? (
              <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
                <Layers className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-slate-900 mb-2">Niciun template creat</h3>
                <p className="text-slate-500 mb-4">Creează primul template pentru a genera proiecte rapid</p>
                <button
                  onClick={() => setShowForm(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700"
                >
                  <Plus className="w-4 h-4" /> Creează template
                </button>
              </div>
            ) : (
              templates.map((template) => (
                <div key={template.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <div className="px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center">
                        <Layers className="w-6 h-6 text-purple-600" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-slate-900">{template.name}</h3>
                        <div className="flex items-center gap-4 mt-1 text-sm text-slate-500">
                          <span>{template.phases?.length || 0} faze</span>
                          <span>{template.phases?.reduce((sum, p) => sum + (p.activities?.length || 0), 0) || 0} activități</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleEdit(template)}
                        className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(template.id)}
                        className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  {template.phases && template.phases.length > 0 && (
                    <div className="px-6 py-3 bg-slate-50 border-t border-slate-100">
                      <div className="flex items-center gap-2 overflow-x-auto pb-1">
                        {template.phases.map((phase, index) => {
                          const status = statuses.find(s => s.id === phase.project_status_id)
                          return (
                            <div key={phase.id} className="flex items-center flex-shrink-0">
                              <div
                                className="px-3 py-1 rounded-full text-xs font-medium text-white"
                                style={{ backgroundColor: status?.color || '#6B7280' }}
                              >
                                {phase.name || `Faza ${index + 1}`}
                              </div>
                              {index < template.phases.length - 1 && (
                                <ChevronRight className="w-4 h-4 text-slate-300 mx-1" />
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Modal document */}
      {addingDocTo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-semibold text-slate-900">Adaugă cerere document</h3>
              <button onClick={closeDocModal} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nume document *</label>
                <input
                  type="text"
                  value={newDocName}
                  onChange={(e) => setNewDocName(e.target.value)}
                  placeholder="Ex: Certificat constatator"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Descriere</label>
                <textarea
                  value={newDocDescription}
                  onChange={(e) => setNewDocDescription(e.target.value)}
                  placeholder="Instrucțiuni pentru client..."
                  rows={3}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg resize-none"
                />
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
                    <button onClick={() => setNewDocTemplate(null)} className="p-1 text-indigo-600 hover:text-indigo-800">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed border-slate-200 rounded-xl cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/50 transition-colors">
                    <Upload className="w-8 h-8 text-slate-400" />
                    <span className="text-sm text-slate-600 font-medium">Click pentru a încărca</span>
                    <span className="text-xs text-slate-400">PDF, DOC, DOCX, XLS, XLSX</span>
                    <input
                      type="file"
                      onChange={(e) => setNewDocTemplate(e.target.files?.[0] || null)}
                      className="hidden"
                      accept=".pdf,.doc,.docx,.xls,.xlsx"
                    />
                  </label>
                )}
              </div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={newDocMandatory}
                  onChange={(e) => setNewDocMandatory(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-indigo-600"
                />
                <span className="text-sm text-slate-700">Document obligatoriu</span>
              </label>
            </div>
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex gap-3">
              <button
                onClick={closeDocModal}
                className="flex-1 px-4 py-2.5 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-white"
              >
                Anulează
              </button>
              <button
                onClick={confirmAddDoc}
                disabled={!newDocName.trim()}
                className="flex-1 px-4 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Check className="w-4 h-4" /> Adaugă
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}