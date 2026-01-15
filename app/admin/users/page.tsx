/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useRouter } from 'next/navigation'

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
      // Apelăm "Robotul" pe care l-am făcut la Pasul 2
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

      alert('Utilizator creat cu succes! 🎉')
      // Resetăm formularul
      setNewEmail('')
      setNewPassword('')
      setNewName('')
      fetchUsers() // Refresh la listă

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

  if (loading) return <div className="p-10 text-center">Se încarcă...</div>

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      
      {/* 1. ZONA DE ADAUGARE (FORMULAR) */}
      <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
        <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
          ➕ Adaugă Utilizator Nou
        </h2>
        
        <form onSubmit={handleCreateUser} className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
          {/* Email */}
          <div className="md:col-span-1">
            <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
            <input 
              type="email" required placeholder="user@firma.ro"
              value={newEmail} onChange={e => setNewEmail(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm"
            />
          </div>

          {/* Nume */}
          <div className="md:col-span-1">
            <label className="block text-xs font-medium text-gray-700 mb-1">Nume Complet</label>
            <input 
              type="text" required placeholder="Ion Popescu"
              value={newName} onChange={e => setNewName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm"
            />
          </div>

          {/* Parola */}
          <div className="md:col-span-1">
            <label className="block text-xs font-medium text-gray-700 mb-1">Parolă Temporară</label>
            <input 
              type="text" required placeholder="parola123"
              value={newPassword} onChange={e => setNewPassword(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm"
            />
          </div>

          {/* Rol */}
          <div className="md:col-span-1">
            <label className="block text-xs font-medium text-gray-700 mb-1">Rol Inițial</label>
            <select 
              value={newRole} onChange={e => setNewRole(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm bg-white"
            >
              <option value="client">Client</option>
              <option value="consultant">Consultant</option>
              <option value="admin">Admin</option>
            </select>
          </div>

          {/* Buton Submit */}
          <div className="md:col-span-1">
            <button 
              type="submit" 
              disabled={isCreating}
              className="w-full py-2 bg-black text-white rounded-lg text-sm font-bold hover:bg-gray-800 transition-all"
            >
              {isCreating ? 'Se creează...' : 'Creează Cont'}
            </button>
          </div>
        </form>
      </div>

      {/* 2. LISTA EXISTENTA */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
          <h3 className="font-bold text-gray-700">Lista Utilizatori Existente</h3>
          <span className="text-xs bg-white px-2 py-1 rounded border">Total: {users.length}</span>
        </div>
        
        <table className="w-full text-left text-sm">
          <thead className="bg-white text-gray-500 border-b border-gray-100">
            <tr>
              <th className="px-6 py-3 font-medium">User</th>
              <th className="px-6 py-3 font-medium">Dată</th>
              <th className="px-6 py-3 font-medium">Rol</th>
              <th className="px-6 py-3 font-medium text-right">Acțiune</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.map((user) => (
              <tr key={user.id} className="hover:bg-gray-50">
                <td className="px-6 py-4">
                  <p className="font-bold text-gray-900">{user.email}</p>
                  <p className="text-xs text-gray-500">{user.full_name || '-'}</p>
                </td>
                <td className="px-6 py-4 text-gray-500">
                  {new Date(user.created_at).toLocaleDateString('ro-RO')}
                </td>
                <td className="px-6 py-4">
                  <span className={`px-2 py-1 rounded text-xs font-bold uppercase
                    ${user.role === 'admin' ? 'bg-red-100 text-red-700' : 
                      user.role === 'consultant' ? 'bg-purple-100 text-purple-700' : 
                      'bg-green-100 text-green-700'}`}>
                    {user.role}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <select 
                    value={user.role || 'client'}
                    onChange={(e) => updateUserRole(user.id, e.target.value)}
                    className="border rounded px-2 py-1 text-xs"
                  >
                    <option value="client">Client</option>
                    <option value="consultant">Consultant</option>
                    <option value="admin">Admin</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}