/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { useEffect, useState, useCallback } from 'react'
import { Users, UserPlus, X } from 'lucide-react'
import { useAuth } from '@/app/providers/AuthProvider'

// Culori pentru avatare
const avatarColors = [
  { from: '#2456a7', to: '#2563eb' },
  { from: '#a855f7', to: '#9333ea' },
  { from: '#ec4899', to: '#db2777' },
  { from: '#6366f1', to: '#4f46e5' },
  { from: '#06b6d4', to: '#0891b2' },
  { from: '#14b8a6', to: '#0d9488' },
  { from: '#10b981', to: '#059669' },
  { from: '#f59e0b', to: '#d97706' },
  { from: '#f97316', to: '#ea580c' },
  { from: '#ef4444', to: '#dc2626' },
]

const getInitials = (name?: string, email?: string): string => {
  if (name && name.trim()) {
    const words = name.trim().split(/\s+/)
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
    return words[0].slice(0, 2).toUpperCase()
  }
  if (email) return email.charAt(0).toUpperCase()
  return '?'
}

const getAvatarColor = (identifier: string) => {
  const hash = identifier.split('').reduce((acc, char) => {
    return char.charCodeAt(0) + ((acc << 5) - acc)
  }, 0)
  return avatarColors[Math.abs(hash) % avatarColors.length]
}

export default function TeamManager({ projectId }: { projectId: string }) {
  const { loading: authLoading, token, apiFetch } = useAuth()

  const [team, setTeam] = useState<any[]>([])
  const [consultants, setConsultants] = useState<any[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)

  const fetchData = useCallback(async () => {
    if (!projectId) return
    if (authLoading) return
    if (!token) return

    setInitialLoading(true)
    try {
      // 1) Membri proiect
      const membersRes = await apiFetch(`/api/projects/${projectId}/members`)
      const membersJson = await membersRes.json()
      if (!membersRes.ok) throw new Error(membersJson?.error || 'Failed to load members')
      setTeam(membersJson.members || [])

      // 2) Consultanți disponibili (endpoint separat)
      const availRes = await apiFetch(`/api/projects/${projectId}/available-consultants`)
      const availJson = await availRes.json()
      if (!availRes.ok) throw new Error(availJson?.error || 'Failed to load consultants')
      setConsultants(availJson.consultants || [])
    } catch (e) {
      console.error('TeamManager fetchData error:', e)
      setTeam([])
      setConsultants([])
    } finally {
      setInitialLoading(false)
    }
  }, [projectId, authLoading, token, apiFetch])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const addMember = async () => {
    if (!selectedId) return
    setLoading(true)

    try {
      const res = await apiFetch(`/api/projects/${projectId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consultant_id: selectedId }),
      })

      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || 'Failed to add member')

      // Adaugă în listă + scoate din dropdown (optional)
      setTeam(prev => [json.member, ...prev])
      setConsultants(prev => prev.filter(c => c.id !== selectedId))
      setSelectedId('')
    } catch (e: any) {
      alert(e?.message || 'Eroare la adăugare')
    } finally {
      setLoading(false)
    }
  }

  const removeMember = async (memberId: string) => {
    if (!confirm('Elimini membrul?')) return

    try {
      const res = await apiFetch(`/api/projects/${projectId}/members/${memberId}`, {
        method: 'DELETE',
      })

      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((json as any)?.error || 'Failed to remove member')

      // Update UI
      const removed = team.find(m => m.id === memberId)
      setTeam(prev => prev.filter(m => m.id !== memberId))

      // (optional) îl readaugi în dropdown dacă ai date despre el
      const profile = removed?.profiles
      if (profile?.id) {
        setConsultants(prev => [{ id: profile.id, full_name: profile.full_name, email: profile.email }, ...prev])
      }
    } catch (e: any) {
      alert(e?.message || 'Eroare la eliminare')
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <Users className="w-4 h-4 text-slate-500" />
            Echipa Alocată
          </h3>
          <span className="bg-slate-100 text-slate-600 text-xs px-2.5 py-1 rounded-full font-medium">
            {team.length}
          </span>
        </div>
      </div>

      <div className="p-6 space-y-6">
        <div className="flex gap-3">
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            disabled={initialLoading}
            className="flex-1 px-4 py-2.5 rounded-lg border border-slate-200 text-sm bg-white outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-400/10 transition-all disabled:opacity-60"
          >
            <option value="">
              {initialLoading ? 'Se încarcă...' : 'Selectează consultant...'}
            </option>
            {consultants.map(c => (
              <option key={c.id} value={c.id}>
                {c.full_name || c.email}
              </option>
            ))}
          </select>

          <button
            onClick={addMember}
            disabled={loading || !selectedId || initialLoading}
            className="px-5 py-2.5 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2"
          >
            <UserPlus className="w-4 h-4" />
            {loading ? 'Se adaugă...' : 'Adaugă'}
          </button>
        </div>

        <div className="space-y-3">
          {initialLoading ? (
            <div className="text-center py-8 border-2 border-dashed border-slate-100 rounded-xl bg-slate-50/50">
              <p className="text-sm text-slate-500">Se încarcă echipa...</p>
            </div>
          ) : team.length === 0 ? (
            <div className="text-center py-8 border-2 border-dashed border-slate-100 rounded-xl bg-slate-50/50">
              <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center mx-auto mb-3">
                <Users className="w-6 h-6 text-slate-400" />
              </div>
              <p className="text-sm font-medium text-slate-900">Niciun membru</p>
              <p className="text-xs text-slate-500 mt-1">Adaugă consultanți în echipă</p>
            </div>
          ) : (
            team.map(member => {
              const profile = member.profiles
              const initials = getInitials(profile?.full_name, profile?.email)
              const color = getAvatarColor(profile?.full_name || profile?.email || member.id)

              return (
                <div
                  key={member.id}
                  className="flex items-center justify-between p-4 rounded-xl border border-slate-100 bg-white hover:border-slate-200 hover:shadow-sm transition-all group"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div
                      className="w-10 h-10 rounded-full text-white flex items-center justify-center text-sm font-bold flex-shrink-0 shadow-sm"
                      style={{ background: `linear-gradient(to bottom right, ${color.from}, ${color.to})` }}
                    >
                      {initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-slate-900 text-sm truncate">
                        {profile?.full_name || 'Nume Lipsă'}
                      </p>
                      <p className="text-xs text-slate-500 truncate">
                        {profile?.email || 'Email lipsă'}
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => removeMember(member.id)}
                    className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                    title="Elimină din echipă"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
