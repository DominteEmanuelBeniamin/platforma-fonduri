/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { 
  Plus, Trash2, GripVertical, Save, X, Palette, 
  Circle, CheckCircle, PlayCircle, FileEdit, Send, Search,
  FileSignature, Wallet, Eye, Archive, AlertCircle
} from 'lucide-react'
import { useAuth } from '@/app/providers/AuthProvider'
import ConfirmDeleteModal from '@/components/ConfirmDeleteModal'

interface ProjectStatus {
  id: string
  name: string
  slug: string
  description: string | null
  color: string
  icon: string
  order_index: number
  is_active: boolean
}

interface ProjectStatusCreate {
  name: string
  slug: string
  description?: string
  color?: string
  icon?: string
  order_index?: number
}

const AVAILABLE_ICONS = [
  { name: 'Circle', icon: Circle },
  { name: 'CheckCircle', icon: CheckCircle },
  { name: 'PlayCircle', icon: PlayCircle },
  { name: 'FileEdit', icon: FileEdit },
  { name: 'Send', icon: Send },
  { name: 'Search', icon: Search },
  { name: 'FileSignature', icon: FileSignature },
  { name: 'Wallet', icon: Wallet },
  { name: 'Eye', icon: Eye },
  { name: 'Archive', icon: Archive },
  { name: 'AlertCircle', icon: AlertCircle },
]

const PRESET_COLORS = [
  '#6366F1', '#8B5CF6', '#EC4899', '#EF4444', '#F59E0B',
  '#10B981', '#06B6D4', '#3B82F6', '#84CC16', '#9CA3AF',
]

function generateSlug(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

export default function AdminStatusesPage() {
  const router = useRouter()
  const { loading: authLoading, token, apiFetch } = useAuth()
  
  const [statuses, setStatuses] = useState<ProjectStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showNewForm, setShowNewForm] = useState(false)
  const [newStatus, setNewStatus] = useState<ProjectStatusCreate>({
    name: '', slug: '', description: '', color: '#6366F1', icon: 'Circle', order_index: 0
  })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editData, setEditData] = useState<Partial<ProjectStatus>>({})
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [statusToDelete, setStatusToDelete] = useState<ProjectStatus | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [hasOrderChanges, setHasOrderChanges] = useState(false)

  const fetchStatuses = async () => {
    try {
      setLoading(true)
      const res = await apiFetch('/api/admin/statuses')
      if (!res.ok) throw new Error('Eroare la încărcare')
      const data = await res.json()
      setStatuses(data.statuses || [])
    } catch (error) {
      console.error('Eroare:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (authLoading) return
    if (!token) { router.replace('/login'); return }
    fetchStatuses()
  }, [authLoading, token, router])

  useEffect(() => {
    if (newStatus.name && !editingId) {
      setNewStatus(prev => ({ ...prev, slug: generateSlug(prev.name) }))
    }
  }, [newStatus.name, editingId])

  const handleCreateStatus = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newStatus.name.trim()) return
    try {
      setSaving(true)
      const res = await apiFetch('/api/admin/statuses', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newStatus, order_index: statuses.length + 1 })
      })
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Eroare') }
      setNewStatus({ name: '', slug: '', description: '', color: '#6366F1', icon: 'Circle', order_index: 0 })
      setShowNewForm(false)
      fetchStatuses()
    } catch (error: any) { alert('Eroare: ' + error.message) }
    finally { setSaving(false) }
  }

  const handleSaveEdit = async () => {
    if (!editingId || !editData.name?.trim()) return
    try {
      setSaving(true)
      const res = await apiFetch(`/api/admin/statuses/${editingId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editData)
      })
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Eroare') }
      setEditingId(null); setEditData({})
      fetchStatuses()
    } catch (error: any) { alert('Eroare: ' + error.message) }
    finally { setSaving(false) }
  }

  const handleDelete = async () => {
    if (!statusToDelete) return
    try {
      setIsDeleting(true)
      const res = await apiFetch(`/api/admin/statuses/${statusToDelete.id}`, { method: 'DELETE' })
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Eroare') }
      setDeleteModalOpen(false); setStatusToDelete(null)
      fetchStatuses()
    } catch (error: any) { alert('Eroare: ' + error.message) }
    finally { setIsDeleting(false) }
  }

  const handleDragStart = (e: React.DragEvent, id: string) => { setDraggedId(id); e.dataTransfer.effectAllowed = 'move' }
  const handleDragOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault()
    if (!draggedId || draggedId === targetId) return
    const draggedIndex = statuses.findIndex(s => s.id === draggedId)
    const targetIndex = statuses.findIndex(s => s.id === targetId)
    if (draggedIndex === -1 || targetIndex === -1) return
    const newStatuses = [...statuses]
    const [removed] = newStatuses.splice(draggedIndex, 1)
    newStatuses.splice(targetIndex, 0, removed)
    newStatuses.forEach((s, i) => { s.order_index = i + 1 })
    setStatuses(newStatuses)
    setHasOrderChanges(true)
  }
  const handleDragEnd = () => { setDraggedId(null) }

  const handleSaveOrder = async () => {
    try {
      setSaving(true)
      const res = await apiFetch('/api/admin/statuses/reorder', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orders: statuses.map((s, i) => ({ id: s.id, order_index: i + 1 })) })
      })
      if (!res.ok) throw new Error('Eroare la salvare ordine')
      setHasOrderChanges(false)
    } catch (error: any) { alert('Eroare: ' + error.message); fetchStatuses() }
    finally { setSaving(false) }
  }

  const renderIcon = (iconName: string, className: string = 'w-5 h-5') => {
    const iconData = AVAILABLE_ICONS.find(i => i.name === iconName)
    if (!iconData) return <Circle className={className} />
    const IconComponent = iconData.icon
    return <IconComponent className={className} />
  }

  if (authLoading || loading) {
    return <div className="min-h-screen bg-slate-50 flex items-center justify-center"><div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div></div>
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900">Statusuri Proiect</h1>
          <p className="text-slate-500 mt-1">Gestionează statusurile mari ale proiectelor.</p>
        </div>

        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            {hasOrderChanges && (
              <button onClick={handleSaveOrder} disabled={saving} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 flex items-center gap-2 disabled:opacity-50">
                <Save className="w-4 h-4" />Salvează ordinea
              </button>
            )}
          </div>
          <button onClick={() => setShowNewForm(true)} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 flex items-center gap-2">
            <Plus className="w-4 h-4" />Status nou
          </button>
        </div>

        {showNewForm && (
          <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-slate-900">Status nou</h3>
              <button onClick={() => setShowNewForm(false)} className="p-1 text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleCreateStatus} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Nume *</label>
                  <input type="text" value={newStatus.name} onChange={e => setNewStatus(prev => ({ ...prev, name: e.target.value }))} placeholder="Ex: Implementare" className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" required />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Slug</label>
                  <input type="text" value={newStatus.slug} onChange={e => setNewStatus(prev => ({ ...prev, slug: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-slate-50" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Descriere</label>
                <input type="text" value={newStatus.description || ''} onChange={e => setNewStatus(prev => ({ ...prev, description: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-2">Culoare</label>
                  <div className="flex flex-wrap gap-2">
                    {PRESET_COLORS.map(color => (
                      <button key={color} type="button" onClick={() => setNewStatus(prev => ({ ...prev, color }))} className={`w-8 h-8 rounded-lg ${newStatus.color === color ? 'ring-2 ring-offset-2 ring-slate-400 scale-110' : 'hover:scale-105'}`} style={{ backgroundColor: color }} />
                    ))}
                    <div className="relative">
                      <input type="color" value={newStatus.color} onChange={e => setNewStatus(prev => ({ ...prev, color: e.target.value }))} className="w-8 h-8 rounded-lg cursor-pointer opacity-0 absolute inset-0" />
                      <div className="w-8 h-8 rounded-lg border-2 border-dashed border-slate-300 flex items-center justify-center" style={{ backgroundColor: newStatus.color }}>
                        <Palette className="w-4 h-4 text-white mix-blend-difference" />
                      </div>
                    </div>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-2">Icon</label>
                  <div className="flex flex-wrap gap-2">
                    {AVAILABLE_ICONS.map(({ name, icon: Icon }) => (
                      <button key={name} type="button" onClick={() => setNewStatus(prev => ({ ...prev, icon: name }))} className={`w-8 h-8 rounded-lg border flex items-center justify-center ${newStatus.icon === name ? 'border-indigo-400 bg-indigo-50 text-indigo-600' : 'border-slate-200 text-slate-500'}`}>
                        <Icon className="w-4 h-4" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="pt-4 border-t border-slate-100">
                <label className="block text-xs font-medium text-slate-700 mb-2">Preview</label>
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium text-white" style={{ backgroundColor: newStatus.color }}>
                  {renderIcon(newStatus.icon || 'Circle', 'w-4 h-4')}{newStatus.name || 'Nume status'}
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={() => setShowNewForm(false)} className="px-4 py-2 border border-slate-200 rounded-lg text-sm">Anulează</button>
                <button type="submit" disabled={saving || !newStatus.name.trim()} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-2">
                  {saving && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}Creează
                </button>
              </div>
            </form>
          </div>
        )}

        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-100">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{statuses.length} statusuri</p>
          </div>
          <div className="divide-y divide-slate-100">
            {statuses.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center mx-auto mb-3"><Circle className="w-6 h-6 text-slate-400" /></div>
                <p className="font-medium text-slate-900">Niciun status</p>
              </div>
            ) : (
              statuses.map((status) => (
                <div key={status.id} draggable onDragStart={(e) => handleDragStart(e, status.id)} onDragOver={(e) => handleDragOver(e, status.id)} onDragEnd={handleDragEnd}
                  className={`flex items-center gap-4 px-4 py-3 transition-colors ${draggedId === status.id ? 'bg-indigo-50 opacity-50' : 'hover:bg-slate-50'} ${editingId === status.id ? 'bg-amber-50' : ''}`}>
                  <div className="cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600"><GripVertical className="w-5 h-5" /></div>
                  <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-xs font-medium text-slate-600">{status.order_index}</div>
                  {editingId === status.id ? (
                    <div className="flex-1 flex items-center gap-3">
                      <input type="text" value={editData.name || ''} onChange={e => setEditData(prev => ({ ...prev, name: e.target.value }))} className="flex-1 px-3 py-1.5 rounded-lg border border-slate-200 text-sm" />
                      <div className="flex items-center gap-1">
                        {PRESET_COLORS.slice(0, 5).map(color => (
                          <button key={color} type="button" onClick={() => setEditData(prev => ({ ...prev, color }))} className={`w-6 h-6 rounded ${editData.color === color ? 'ring-2 ring-offset-1 ring-slate-400' : ''}`} style={{ backgroundColor: color }} />
                        ))}
                      </div>
                      <button onClick={handleSaveEdit} disabled={saving} className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg"><Save className="w-4 h-4" /></button>
                      <button onClick={() => { setEditingId(null); setEditData({}) }} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg"><X className="w-4 h-4" /></button>
                    </div>
                  ) : (
                    <>
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white" style={{ backgroundColor: status.color }}>{renderIcon(status.icon, 'w-4 h-4')}</div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-slate-900">{status.name}</p>
                        {status.description && <p className="text-xs text-slate-500 truncate">{status.description}</p>}
                      </div>
                      <code className="px-2 py-1 bg-slate-100 rounded text-xs text-slate-600 font-mono">{status.slug}</code>
                      <div className="flex items-center gap-1">
                        <button onClick={() => { setEditingId(status.id); setEditData({ name: status.name, description: status.description, color: status.color, icon: status.icon }) }} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg"><FileEdit className="w-4 h-4" /></button>
                        <button onClick={() => { setStatusToDelete(status); setDeleteModalOpen(true) }} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      <ConfirmDeleteModal isOpen={deleteModalOpen} onClose={() => { setDeleteModalOpen(false); setStatusToDelete(null) }} onConfirm={handleDelete} title={`Șterge statusul "${statusToDelete?.name}"`} description="Statusul va fi șters permanent." confirmWord="sterge" loading={isDeleting} />
    </div>
  )
}