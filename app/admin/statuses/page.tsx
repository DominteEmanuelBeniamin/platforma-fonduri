'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { 
  Plus, Trash2, GripVertical, Save, X, Palette, 
  Circle, CheckCircle, PlayCircle, FileEdit, Send, Search,
  FileSignature, Wallet, Eye, Archive, AlertCircle
} from 'lucide-react'
import { LocationStrip } from '@/components/ui/LocationStrip'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/app/providers/AuthProvider'
import ConfirmDeleteModal from '@/components/ConfirmDeleteModal'
import { useToast } from '@/app/providers/ToastProvider'
import { Spinner } from '@/components/ui/Spinner'

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
  const { showToast } = useToast()
  
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

  const fetchStatuses = useCallback(async () => {
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
  }, [apiFetch])

  useEffect(() => {
    if (authLoading) return
    if (!token) { router.replace('/login'); return }
    fetchStatuses()
  }, [authLoading, token, router, fetchStatuses])

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
    } catch { showToast('Nu am putut salva statusul. Reîncearcă.', 'error') }
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
    } catch { showToast('Nu am putut actualiza statusul. Reîncearcă.', 'error') }
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
    } catch { showToast('Nu am putut șterge statusul. Reîncearcă.', 'error') }
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
    } catch { showToast('Nu am putut salva ordinea. Reîncearcă.', 'error'); fetchStatuses() }
    finally { setSaving(false) }
  }

  const renderIcon = (iconName: string, className: string = 'w-5 h-5') => {
    const iconData = AVAILABLE_ICONS.find(i => i.name === iconName)
    if (!iconData) return <Circle className={className} />
    const IconComponent = iconData.icon
    return <IconComponent className={className} />
  }

  if (authLoading || loading) {
    return <div className="flex min-h-[60vh] items-center justify-center" role="status" aria-live="polite"><Spinner size="md" /><span className="sr-only">Se încarcă statusurile…</span></div>
  }

  return (
    <div>
      <div className="mx-auto max-w-4xl">
        <LocationStrip
          segments={[{ label: 'Bonie', href: '/' }, { label: 'Statusuri' }]}
          action={
            <>
              {hasOrderChanges && (
                <Button variant="primary" aria-label="Salvează ordinea" onClick={handleSaveOrder} disabled={saving}>
                  <Save className="h-4 w-4" aria-hidden="true" />
                  <span className="hidden sm:inline">Salvează ordinea</span>
                </Button>
              )}
              <Button variant={hasOrderChanges ? 'secondary' : 'primary'} aria-label="Status nou" onClick={() => setShowNewForm(true)}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Status nou</span>
              </Button>
            </>
          }
        />

        <h1 className="text-3xl font-bold tracking-tight text-ink md:text-4xl">Statusuri</h1>
        <p className="mb-8 mt-2 text-sm text-ink-soft">
          Etapele mari prin care trece un proiect. Ordinea lor e cea în care apar peste tot în platformă.
        </p>


        {showNewForm && (
          <div className="mb-6 rounded-[var(--radius-plate)] border border-rule bg-plate p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-ink">Status nou</h3>
              <button onClick={() => setShowNewForm(false)} className="p-1 text-ink-faint hover:text-ink-soft"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleCreateStatus} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-ink mb-1">Nume *</label>
                  <input type="text" value={newStatus.name} onChange={e => setNewStatus(prev => ({ ...prev, name: e.target.value }))} placeholder="Ex: Implementare" className="w-full px-3 py-2 rounded-lg border border-rule text-sm" required />
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink mb-1">Slug</label>
                  <input type="text" value={newStatus.slug} onChange={e => setNewStatus(prev => ({ ...prev, slug: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-rule text-sm bg-paper-sunk" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-ink mb-1">Descriere</label>
                <input type="text" value={newStatus.description || ''} onChange={e => setNewStatus(prev => ({ ...prev, description: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-rule text-sm" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-ink mb-2">Culoare</label>
                  <div className="flex flex-wrap gap-2">
                    {PRESET_COLORS.map(color => (
                      <button key={color} type="button" onClick={() => setNewStatus(prev => ({ ...prev, color }))} className={`w-8 h-8 rounded-lg ${newStatus.color === color ? 'ring-2 ring-offset-2 ring-rule-strong scale-110' : 'hover:scale-105'}`} style={{ backgroundColor: color }} />
                    ))}
                    <div className="relative">
                      <input type="color" value={newStatus.color} onChange={e => setNewStatus(prev => ({ ...prev, color: e.target.value }))} className="w-8 h-8 rounded-lg cursor-pointer opacity-0 absolute inset-0" />
                      <div className="w-8 h-8 rounded-lg border-2 border-dashed border-rule-strong flex items-center justify-center" style={{ backgroundColor: newStatus.color }}>
                        <Palette className="w-4 h-4 text-white mix-blend-difference" />
                      </div>
                    </div>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink mb-2">Icon</label>
                  <div className="flex flex-wrap gap-2">
                    {AVAILABLE_ICONS.map(({ name, icon: Icon }) => (
                      <button key={name} type="button" onClick={() => setNewStatus(prev => ({ ...prev, icon: name }))} className={`w-8 h-8 rounded-lg border flex items-center justify-center ${newStatus.icon === name ? 'border-[var(--sg-accent)] bg-[var(--sg-accent-soft)] text-[var(--sg-accent)]' : 'border-rule text-ink-soft'}`}>
                        <Icon className="w-4 h-4" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="pt-4 border-t border-rule">
                <label className="block text-xs font-medium text-ink mb-2">Preview</label>
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium text-white" style={{ backgroundColor: newStatus.color }}>
                  {renderIcon(newStatus.icon || 'Circle', 'w-4 h-4')}{newStatus.name || 'Nume status'}
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={() => setShowNewForm(false)} className="px-4 py-2 border border-rule rounded-lg text-sm">Anulează</button>
                <button type="submit" disabled={saving || !newStatus.name.trim()} className="px-4 py-2 bg-[var(--sg-accent)] text-white rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-2">
                  {saving && <Spinner size="sm" on="accent" />}Creează
                </button>
              </div>
            </form>
          </div>
        )}

        <div className="overflow-hidden border-t border-rule pb-10">
          <div className="divide-y divide-rule">
            {statuses.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <div className="w-12 h-12 bg-paper-sunk rounded-xl flex items-center justify-center mx-auto mb-3"><Circle className="w-6 h-6 text-ink-faint" /></div>
                <p className="font-medium text-ink">Niciun status</p>
              </div>
            ) : (
              statuses.map((status) => (
                <div key={status.id} draggable onDragStart={(e) => handleDragStart(e, status.id)} onDragOver={(e) => handleDragOver(e, status.id)} onDragEnd={handleDragEnd}
                  className={`flex items-center gap-4 px-4 py-3 transition-colors ${draggedId === status.id ? 'bg-[var(--sg-accent-soft)] opacity-50' : 'hover:bg-paper-sunk'} ${editingId === status.id ? 'bg-[var(--sg-warn-soft)]' : ''}`}>
                  <div className="cursor-grab active:cursor-grabbing text-ink-faint hover:text-ink-soft"><GripVertical className="w-5 h-5" /></div>
                  <div className="w-6 h-6 rounded-full bg-paper-sunk flex items-center justify-center text-xs font-medium text-ink-soft">{status.order_index}</div>
                  {editingId === status.id ? (
                    <div className="flex-1 flex items-center gap-3">
                      <input type="text" value={editData.name || ''} onChange={e => setEditData(prev => ({ ...prev, name: e.target.value }))} className="flex-1 px-3 py-1.5 rounded-lg border border-rule text-sm" />
                      <div className="flex items-center gap-1">
                        {PRESET_COLORS.slice(0, 5).map(color => (
                          <button key={color} type="button" onClick={() => setEditData(prev => ({ ...prev, color }))} className={`w-6 h-6 rounded ${editData.color === color ? 'ring-2 ring-offset-1 ring-rule-strong' : ''}`} style={{ backgroundColor: color }} />
                        ))}
                      </div>
                      <button onClick={handleSaveEdit} disabled={saving} className="p-1.5 text-[var(--sg-ok)] hover:bg-[var(--sg-ok-soft)] rounded-lg"><Save className="w-4 h-4" /></button>
                      <button onClick={() => { setEditingId(null); setEditData({}) }} className="p-1.5 text-ink-faint hover:bg-paper-sunk rounded-lg"><X className="w-4 h-4" /></button>
                    </div>
                  ) : (
                    <>
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white" style={{ backgroundColor: status.color }}>{renderIcon(status.icon, 'w-4 h-4')}</div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-ink">{status.name}</p>
                        {status.description && <p className="text-xs text-ink-soft truncate">{status.description}</p>}
                      </div>
                      <code className="px-2 py-1 bg-paper-sunk rounded text-xs text-ink-soft font-mono">{status.slug}</code>
                      <div className="flex items-center gap-1">
                        <button onClick={() => { setEditingId(status.id); setEditData({ name: status.name, description: status.description, color: status.color, icon: status.icon }) }} className="p-1.5 text-ink-faint hover:text-ink-soft hover:bg-paper-sunk rounded-lg"><FileEdit className="w-4 h-4" /></button>
                        <button onClick={() => { setStatusToDelete(status); setDeleteModalOpen(true) }} className="p-1.5 text-ink-faint hover:text-[var(--sg-danger)] hover:bg-[var(--sg-danger-soft)] rounded-lg"><Trash2 className="w-4 h-4" /></button>
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
