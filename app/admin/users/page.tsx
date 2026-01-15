/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useRouter } from 'next/navigation'
import { UserPlus, Trash2, Users } from 'lucide-react'

export default function AdminUsersPage() {
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

  const [users, setUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  // State-uri pentru formularul de adăugare
  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newName, setNewName] = useState('')
  const [newRole, setNewRole] = useState('client')
  const [isCreating, setIsCreating] = useState(false)

  const fetchUsers = async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false })
    
    if (data) setUsers(data)
    setLoading(false)
  }

  useEffect(() => {
    fetchUsers()
  }, [])

  // --- FUNCȚIA DE CREARE USER ---
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsCreating(true)

    try {
      const response = await fetch('/api/create-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: newEmail,
          password: newPassword,
          role: newRole,
          fullName: newName
        })
      })

      const result = await response.json()

      if (!response.ok) throw new Error(result.error)

      alert('Utilizator creat cu succes!')
      setNewEmail('')
      setNewPassword('')
      setNewName('')
      fetchUsers()

    } catch (error: any) {
      alert('Eroare: ' + error.message)
    } finally {
      setIsCreating(false)
    }
  }

  const updateUserRole = async (userId: string, newRole: string) => {
    if (!confirm(`Schimbi rolul?`)) return
    await supabase.from('profiles').update({ role: newRole }).eq('id', userId)
    fetchUsers()
  }

  // --- FUNCȚIA DE ȘTERGERE USER ---
  const handleDeleteUser = async (userId: string, userEmail: string) => {
    if (!confirm(`Ești sigur că vrei să ștergi utilizatorul "${userEmail}"?\n\nAceastă acțiune este PERMANENTĂ!`)) return
    
    setLoading(true)
    try {
      const response = await fetch('/api/delete-user', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      })

      const result = await response.json()

      if (!response.ok) throw new Error(result.error)

      alert('Utilizator șters cu succes!')
      fetchUsers()

    } catch (error: any) {
      alert('Eroare la ștergere: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-slate-100 border-t-indigo-600 rounded-full animate-spin"></div>
          <p className="text-sm text-slate-500 font-medium">Se încarcă utilizatorii...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 fade-in-up">
      
      {/* HEADER */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900">Gestionare Utilizatori</h1>
          <p className="text-sm text-slate-500 mt-1">Adaugă, editează sau șterge utilizatori din platformă</p>
        </div>
        <div className="bg-white px-5 py-3 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center">
              <Users className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500">Total utilizatori</p>
              <p className="text-xl font-bold text-slate-900">{users.length}</p>
            </div>
          </div>
        </div>
      </div>

      {/* FORMULAR ADĂUGARE */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-slate-500" />
            <h2 className="text-sm font-semibold text-slate-900">Adaugă utilizator nou</h2>
          </div>
        </div>
        
        <div className="p-6">
          <form onSubmit={handleCreateUser} className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
            <div className="md:col-span-1">
              <label className="block text-xs font-medium text-slate-700 mb-2">Email</label>
              <input 
                type="email" 
                required 
                placeholder="user@firma.ro"
                value={newEmail} 
                onChange={e => setNewEmail(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg border border-slate-200 text-sm focus:border-slate-400 focus:ring-2 focus:ring-slate-400/10 outline-none transition-all"
              />
            </div>

            <div className="md:col-span-1">
              <label className="block text-xs font-medium text-slate-700 mb-2">Nume complet</label>
              <input 
                type="text" 
                required 
                placeholder="Ion Popescu"
                value={newName} 
                onChange={e => setNewName(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg border border-slate-200 text-sm focus:border-slate-400 focus:ring-2 focus:ring-slate-400/10 outline-none transition-all"
              />
            </div>

            <div className="md:col-span-1">
              <label className="block text-xs font-medium text-slate-700 mb-2">Parolă temporară</label>
              <input 
                type="text" 
                required 
                placeholder="parola123"
                value={newPassword} 
                onChange={e => setNewPassword(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg border border-slate-200 text-sm focus:border-slate-400 focus:ring-2 focus:ring-slate-400/10 outline-none transition-all"
              />
            </div>

            <div className="md:col-span-1">
              <label className="block text-xs font-medium text-slate-700 mb-2">Rol inițial</label>
              <select 
                value={newRole} 
                onChange={e => setNewRole(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg border border-slate-200 text-sm bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-400/10 outline-none transition-all"
              >
                <option value="client">Client</option>
                <option value="consultant">Consultant</option>
                <option value="admin">Admin</option>
              </select>
            </div>

            <div className="md:col-span-1">
              <button 
                type="submit" 
                disabled={isCreating}
                className="w-full py-2.5 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
              >
                {isCreating ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    Se creează...
                  </>
                ) : (
                  <>
                    <UserPlus className="w-4 h-4" />
                    Creează cont
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* TABEL UTILIZATORI */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <h3 className="text-sm font-semibold text-slate-900">Lista utilizatori existenți</h3>
        </div>
        
        <div className="p-6 space-y-3">
          {users.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Users className="w-8 h-8 text-slate-300" />
              </div>
              <p className="font-semibold text-slate-900 mb-1">Niciun utilizator</p>
              <p className="text-sm text-slate-500">Adaugă primul utilizator folosind formularul de mai sus</p>
            </div>
          ) : (
            users.map((user) => (
              <div 
                key={user.id} 
                className="flex items-center justify-between p-4 bg-white border border-slate-100 rounded-xl hover:border-slate-200 hover:shadow-sm transition-all"
              >
                {/* Utilizator Info */}
                <div className="flex items-center gap-3 flex-1">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-indigo-600 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
                    {user.email?.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-900">{user.email}</p>
                    <p className="text-xs text-slate-500">{user.full_name || 'Nume lipsă'}</p>
                  </div>
                </div>

                {/* Date */}
                <div className="hidden md:block text-sm text-slate-600 px-6">
                  {new Date(user.created_at).toLocaleDateString('ro-RO', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric'
                  })}
                </div>

                {/* Role Badge */}
                <div className="hidden sm:block px-6">
                  <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium border
                    ${user.role === 'admin' ? 'bg-red-50 text-red-700 border-red-200' : 
                      user.role === 'consultant' ? 'bg-purple-50 text-purple-700 border-purple-200' : 
                      'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
                    {user.role === 'admin' ? 'Admin' : user.role === 'consultant' ? 'Consultant' : 'Client'}
                  </span>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-3">
                  <select 
                    value={user.role || 'client'}
                    onChange={(e) => updateUserRole(user.id, e.target.value)}
                    className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs focus:border-slate-400 focus:ring-2 focus:ring-slate-400/10 outline-none transition-all"
                  >
                    <option value="client">Client</option>
                    <option value="consultant">Consultant</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button
                    onClick={() => handleDeleteUser(user.id, user.email)}
                    className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                    title="Șterge utilizator"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}