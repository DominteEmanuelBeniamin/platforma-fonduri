/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react-hooks/exhaustive-deps */
'use client'
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabaseClient'
import { Users, UserPlus, X } from 'lucide-react'

// Culori pentru avatare
const avatarColors = [
  { from: '#3b82f6', to: '#2563eb' }, // blue
  { from: '#a855f7', to: '#9333ea' }, // purple
  { from: '#ec4899', to: '#db2777' }, // pink
  { from: '#6366f1', to: '#4f46e5' }, // indigo
  { from: '#06b6d4', to: '#0891b2' }, // cyan
  { from: '#14b8a6', to: '#0d9488' }, // teal
  { from: '#10b981', to: '#059669' }, // green
  { from: '#f59e0b', to: '#d97706' }, // amber
  { from: '#f97316', to: '#ea580c' }, // orange
  { from: '#ef4444', to: '#dc2626' }, // red
]

// Funcție pentru a genera initiale
const getInitials = (name?: string, email?: string): string => {
  if (name && name.trim()) {
    const words = name.trim().split(/\s+/)
    if (words.length >= 2) {
      return (words[0][0] + words[1][0]).toUpperCase()
    }
    return words[0].slice(0, 2).toUpperCase()
  }
  if (email) {
    return email.charAt(0).toUpperCase()
  }
  return '?'
}

// Funcție pentru a selecta culoare bazată pe nume/email
const getAvatarColor = (identifier: string) => {
  const hash = identifier.split('').reduce((acc, char) => {
    return char.charCodeAt(0) + ((acc << 5) - acc)
  }, 0)
  return avatarColors[Math.abs(hash) % avatarColors.length]
}

export default function TeamManager({ projectId }: { projectId: string }) {
  const [team, setTeam] = useState<any[]>([])
  const [consultants, setConsultants] = useState<any[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(false)

  const fetchData = async () => {
    const { data: teamData, error } = await supabase
      .from('project_members')
      .select(`
        *,
        profiles:consultant_id (
          id,
          email,
          full_name,
          role
        )
      `)
      .eq('project_id', projectId)

    if (error) {
      console.error('Eroare la citire echipa:', error)
    } else {
      console.log('Echipa descărcată:', teamData)
      setTeam(teamData || [])
    }

    const { data: allConsultants } = await supabase
      .from('profiles')
      .select('*')
      .eq('role', 'consultant')

    if (allConsultants) setConsultants(allConsultants)
  }

  useEffect(() => {
    if (projectId) fetchData()
  }, [projectId])

  const addMember = async () => {
    if (!selectedId) return
    setLoading(true)

    if (team.some(m => m.consultant_id === selectedId)) {
      alert('Este deja în echipă!')
      setLoading(false)
      return
    }

    const { error } = await supabase
      .from('project_members')
      .insert({ project_id: projectId, consultant_id: selectedId })

    if (error) alert('Eroare: ' + error.message)
    else {
      await fetchData()
      setSelectedId('')
    }
    setLoading(false)
  }

  const removeMember = async (id: string) => {
    if (!confirm('Elimini membrul?')) return
    await supabase.from('project_members').delete().eq('id', id)
    fetchData()
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
            className="flex-1 px-4 py-2.5 rounded-lg border border-slate-200 text-sm bg-white outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-400/10 transition-all"
          >
            <option value="">Selectează consultant...</option>
            {consultants.map(c => (
              <option key={c.id} value={c.id}>
                {c.full_name || c.email}
              </option>
            ))}
          </select>
          <button 
            onClick={addMember}
            disabled={loading || !selectedId}
            className="px-5 py-2.5 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2"
          >
            <UserPlus className="w-4 h-4" />
            {loading ? 'Se adaugă...' : 'Adaugă'}
          </button>
        </div>

        <div className="space-y-3">
          {team.length === 0 ? (
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
                      style={{
                        background: `linear-gradient(to bottom right, ${color.from}, ${color.to})`
                      }}
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