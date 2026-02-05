/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { UserPlus, Trash2, Users, Building2, Briefcase, Shield, Info } from 'lucide-react'
import { useAuth } from '@/app/providers/AuthProvider'
import ConfirmDeleteModal from '@/components/ConfirmDeleteModal'

// Configurație pentru fiecare tip de rol
// AM ADĂUGAT: btnBg și btnHover pentru a fi recunoscute de Tailwind
const roleConfig = {
  admin: {
    icon: Shield,
    color: 'red',
    bg: 'bg-red-50',
    border: 'border-red-200',
    text: 'text-red-700',
    iconBg: 'bg-red-100',
    label: 'Administrator',
    btnBg: 'bg-red-600',
    btnHover: 'hover:bg-red-700'
  },
  consultant: {
    icon: Briefcase,
    color: 'purple',
    bg: 'bg-purple-50',
    border: 'border-purple-200',
    text: 'text-purple-700',
    iconBg: 'bg-purple-100',
    label: 'Consultant',
    btnBg: 'bg-purple-600',
    btnHover: 'hover:bg-purple-700'
  },
  client: {
    icon: Building2,
    color: 'emerald',
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    text: 'text-emerald-700',
    iconBg: 'bg-emerald-100',
    label: 'Client (Firmă)',
    btnBg: 'bg-emerald-600',
    btnHover: 'hover:bg-emerald-700'
  }
}

export default function AdminUsersPage() {
  const router = useRouter()
  const [users, setUsers] = useState<any[]>([])
  const { loading: authLoading, token, apiFetch } = useAuth()
  const [updatingRoleId, setUpdatingRoleId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // State-uri formular
  const [newRole, setNewRole] = useState<'admin' | 'consultant' | 'client'>('client')
  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newName, setNewName] = useState('')
  const [telefon, setTelefon] = useState('')
  
  // Câmpuri specifice CLIENT
  const [cif, setCif] = useState('')
  const [numeFirma, setNumeFirma] = useState('')
  const [adresaFirma, setAdresaFirma] = useState('')
  const [persoanaContact, setPersoanaContact] = useState('')
  
  // Câmpuri specifice CONSULTANT
  const [specializare, setSpecializare] = useState('')
  const [departament, setDepartament] = useState('')
  
  const [isCreating, setIsCreating] = useState(false)

  // State-uri pentru modal ștergere
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [userToDelete, setUserToDelete] = useState<{ id: string; email: string } | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const fetchUsers = async () => {
    try {
      setLoading(true)
      const ctx = await apiFetch('/api/users')
      if (!ctx.ok) {
        alert('Eroare la încărcarea utilizatorilor.')
        setLoading(false)
        return
      }
      const { users: data } = await ctx.json()
      setUsers(data)
    } catch (error) {
      alert('Eroare la încărcarea utilizatorilor.')
      setLoading(false)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (authLoading) return
    if (!token) {
      router.replace('/login')
      return
    }
    fetchUsers()
  }, [authLoading, token, router])

  // Reset câmpuri specifice când se schimbă rolul
  useEffect(() => {
    setCif('')
    setNumeFirma('')
    setAdresaFirma('')
    setPersoanaContact('')
    setSpecializare('')
    setDepartament('')
  }, [newRole])

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsCreating(true)

    try {
      const payload: any = {
        email: newEmail,
        password: newPassword,
        role: newRole,
        fullName: newName,
        telefon: telefon || null
      }

      // Adaugă câmpuri specifice pe bază de rol
      if (newRole === 'client') {
        payload.cif = cif || null
        payload.numeFirma = numeFirma || null
        payload.adresaFirma = adresaFirma || null
        payload.persoanaContact = persoanaContact || null
      } else if (newRole === 'consultant') {
        payload.specializare = specializare || null
        payload.departament = departament || null
      } else if (newRole === 'admin') {
        payload.departament = departament || null
      }

      const ctx = await apiFetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (!ctx.ok) {
        const err = await ctx.json()
        throw new Error(err.error)
      }

      alert('Utilizator creat cu succes!')
      
      // Reset formular
      setNewEmail('')
      setNewPassword('')
      setNewName('')
      setTelefon('')
      setCif('')
      setNumeFirma('')
      setAdresaFirma('')
      setPersoanaContact('')
      setSpecializare('')
      setDepartament('')
      
      fetchUsers()
    } catch (error: any) {
      alert('Eroare: ' + error.message)
    } finally {
      setIsCreating(false)
    }
  }

  const updateUserRole = async (userId: string, newRole: string) => {
    if (!confirm(`Schimbi rolul?`)) return
    
    try {
      setUpdatingRoleId(userId)
      const ctx = await apiFetch(`/api/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole })
      })

      if (!ctx.ok) {
        const err = await ctx.json()
        throw new Error(err.error)
      }
    } catch (error: any) {
      alert('Eroare la update: ' + error.message)
      return
    } finally {
      setUpdatingRoleId(null)
    }
    fetchUsers()
    alert('Rol actualizat cu succes!')
  }

  // Deschide modalul de ștergere
  const openDeleteModal = (userId: string, userEmail: string) => {
    setUserToDelete({ id: userId, email: userEmail })
    setDeleteModalOpen(true)
  }

  // Confirmă ștergerea
  const handleConfirmDelete = async () => {
    if (!userToDelete) return
    
    setIsDeleting(true)
    try {
      const ctx = await apiFetch(`/api/users/${userToDelete.id}`, {
        method: 'DELETE',
      })
      if (!ctx.ok) {
        const err = await ctx.json()
        throw new Error(err.error)
      }
      setDeleteModalOpen(false)
      setUserToDelete(null)
      fetchUsers()
    } catch (error: any) {
      alert('Eroare la ștergere: ' + error.message)
    } finally {
      setIsDeleting(false)
    }
  }

  if (authLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-slate-100 border-t-indigo-600 rounded-full animate-spin"></div>
          <p className="text-sm text-slate-500 font-medium">Se verifică autentificarea…</p>
        </div>
      </div>
    )
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

  const currentRoleConfig = roleConfig[newRole]
  const RoleIcon = currentRoleConfig.icon

  return (
    <div className="max-w-7xl mx-auto space-y-6 fade-in-up">
      
      {/* MODAL ȘTERGERE */}
      <ConfirmDeleteModal
        isOpen={deleteModalOpen}
        onClose={() => {
          setDeleteModalOpen(false)
          setUserToDelete(null)
        }}
        onConfirm={handleConfirmDelete}
        title="Șterge utilizator"
        description={`Ești sigur că vrei să ștergi utilizatorul "${userToDelete?.email}"? Această acțiune este permanentă și nu poate fi anulată.`}
        confirmText="Șterge utilizator"
        confirmWord="sterge"
        loading={isDeleting}
      />

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
        
        <form onSubmit={handleCreateUser} className="p-6 space-y-6">
          
          {/* SELECTOR ROL */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-3 uppercase tracking-wider">
              Tip utilizator
            </label>
            <div className="grid grid-cols-3 gap-3">
              {(['client', 'consultant', 'admin'] as const).map((role) => {
                const config = roleConfig[role]
                const Icon = config.icon
                const isSelected = newRole === role
                
                return (
                  <button
                    key={role}
                    type="button"
                    onClick={() => setNewRole(role)}
                    className={`
                      relative p-4 rounded-xl border-2 transition-all duration-200
                      ${isSelected 
                        ? `${config.border} ${config.bg} shadow-md` 
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                      }
                    `}
                  >
                    <div className="flex flex-col items-center gap-2">
                      <div className={`
                        w-12 h-12 rounded-lg flex items-center justify-center
                        ${isSelected ? config.iconBg : 'bg-slate-100'}
                        ${isSelected ? config.text : 'text-slate-500'}
                        transition-colors duration-200
                      `}>
                        <Icon className="w-6 h-6" />
                      </div>
                      <span className={`
                        text-sm font-semibold
                        ${isSelected ? config.text : 'text-slate-600'}
                      `}>
                        {config.label}
                      </span>
                    </div>
                    
                    {/* Checkmark */}
                    {isSelected && (
                      <div className={`
                        absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center
                        ${config.iconBg} ${config.text}
                      `}>
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* CÂMPURI COMUNE */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-2">
                Email *
              </label>
              <input 
                type="email" 
                required 
                placeholder="user@firma.ro"
                value={newEmail} 
                onChange={e => setNewEmail(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg border border-slate-200 text-sm focus:border-slate-400 focus:ring-2 focus:ring-slate-400/10 outline-none transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-2">
                Nume complet *
              </label>
              <input 
                type="text" 
                required 
                placeholder="Ion Popescu"
                value={newName} 
                onChange={e => setNewName(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg border border-slate-200 text-sm focus:border-slate-400 focus:ring-2 focus:ring-slate-400/10 outline-none transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-2">
                Parolă temporară *
              </label>
              <input 
                type="text" 
                required 
                placeholder="parola123"
                value={newPassword} 
                onChange={e => setNewPassword(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg border border-slate-200 text-sm focus:border-slate-400 focus:ring-2 focus:ring-slate-400/10 outline-none transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-2">
                Telefon
              </label>
              <input 
                type="tel" 
                placeholder="0740123456"
                value={telefon} 
                onChange={e => setTelefon(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg border border-slate-200 text-sm focus:border-slate-400 focus:ring-2 focus:ring-slate-400/10 outline-none transition-all"
              />
            </div>
          </div>

          {/* SECȚIUNE DINAMICĂ */}
          <div 
            className={`
              border-2 rounded-xl p-5 transition-all duration-300
              ${currentRoleConfig.border} ${currentRoleConfig.bg}
            `}
          >
            <div className="flex items-center gap-2 mb-4">
              <RoleIcon className={`w-5 h-5 ${currentRoleConfig.text}`} />
              <h3 className={`text-sm font-bold ${currentRoleConfig.text}`}>
                Detalii specifice {currentRoleConfig.label}
              </h3>
            </div>

            {/* CÂMPURI CLIENT */}
            {newRole === 'client' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-fadeIn">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-2 flex items-center gap-1">
                    CIF / CUI *
                    <div className="group relative">
                      <Info className="w-3.5 h-3.5 text-slate-400 cursor-help" />
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-slate-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap">
                        Ex: RO12345678
                      </div>
                    </div>
                  </label>
                  <input 
                    type="text" 
                    required
                    placeholder="RO12345678"
                    value={cif} 
                    onChange={e => setCif(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-lg border border-slate-200 text-sm focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/10 outline-none transition-all"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-2">
                    Nume firmă *
                  </label>
                  <input 
                    type="text" 
                    required
                    placeholder="SC TECH SOLUTIONS SRL"
                    value={numeFirma} 
                    onChange={e => setNumeFirma(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-lg border border-slate-200 text-sm focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/10 outline-none transition-all"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-2">
                    Adresă firmă
                  </label>
                  <input 
                    type="text" 
                    placeholder="Str. Principală nr. 10, București"
                    value={adresaFirma} 
                    onChange={e => setAdresaFirma(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-lg border border-slate-200 text-sm focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/10 outline-none transition-all"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-2 flex items-center gap-1">
                    Persoană de contact
                    <div className="group relative">
                      <Info className="w-3.5 h-3.5 text-slate-400 cursor-help" />
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-slate-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap">
                        Dacă diferă de utilizator
                      </div>
                    </div>
                  </label>
                  <input 
                    type="text" 
                    placeholder="Ana Popescu"
                    value={persoanaContact} 
                    onChange={e => setPersoanaContact(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-lg border border-slate-200 text-sm focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/10 outline-none transition-all"
                  />
                </div>
              </div>
            )}

            {/* CÂMPURI CONSULTANT */}
            {newRole === 'consultant' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-fadeIn">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-2 flex items-center gap-1">
                    Specializare *
                    <div className="group relative">
                      <Info className="w-3.5 h-3.5 text-slate-400 cursor-help" />
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-slate-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap">
                        Ex: PNRR, Digitalizare IMM
                      </div>
                    </div>
                  </label>
                  <input 
                    type="text" 
                    required
                    placeholder="Digitalizare IMM, PNRR"
                    value={specializare} 
                    onChange={e => setSpecializare(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-lg border border-slate-200 text-sm focus:border-purple-400 focus:ring-2 focus:ring-purple-400/10 outline-none transition-all"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-2">
                    Departament
                  </label>
                  <input 
                    type="text" 
                    placeholder="Departament Proiecte"
                    value={departament} 
                    onChange={e => setDepartament(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-lg border border-slate-200 text-sm focus:border-purple-400 focus:ring-2 focus:ring-purple-400/10 outline-none transition-all"
                  />
                </div>
              </div>
            )}

            {/* CÂMPURI ADMIN */}
            {newRole === 'admin' && (
              <div className="animate-fadeIn">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-2">
                    Departament
                  </label>
                  <input 
                    type="text" 
                    placeholder="Management, IT, etc."
                    value={departament} 
                    onChange={e => setDepartament(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-lg border border-slate-200 text-sm focus:border-red-400 focus:ring-2 focus:ring-red-400/10 outline-none transition-all"
                  />
                </div>
                <p className="text-xs text-slate-500 mt-3 flex items-start gap-2">
                  <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>Administratorii au acces complet la toate funcționalitățile platformei.</span>
                </p>
              </div>
            )}
          </div>

          {/* PREVIEW ȘI SUBMIT */}
          <div className="flex items-center justify-between pt-4 border-t border-slate-200">
            <div className="text-sm text-slate-600">
              <span className="font-medium">Vei crea:</span>{' '}
              <span className={`font-bold ${currentRoleConfig.text}`}>
                {newName || 'Utilizator nou'} ({currentRoleConfig.label})
              </span>
            </div>

            <button 
              type="submit" 
              disabled={isCreating}
              // AM MODIFICAT AICI: Folosim clasele explicite (btnBg, btnHover)
              className={`
                px-6 py-2.5 rounded-lg text-sm font-bold text-white
                transition-all shadow-lg
                ${currentRoleConfig.btnBg}
                ${currentRoleConfig.btnHover}
                disabled:opacity-50 disabled:cursor-not-allowed
                flex items-center gap-2
              `}
            >
              {isCreating ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  Se creează...
                </>
              ) : (
                <>
                  <UserPlus className="w-4 h-4" />
                  Creează {currentRoleConfig.label}
                </>
              )}
            </button>
          </div>
        </form>
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
                  <div className="relative">
                    <select 
                      value={user.role || 'client'}
                      onChange={(e) => updateUserRole(user.id, e.target.value)}
                      disabled={updatingRoleId === user.id}
                      className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs focus:border-slate-400 focus:ring-2 focus:ring-slate-400/10 outline-none transition-all disabled:opacity-50"
                    >
                      <option value="client">Client</option>
                      <option value="consultant">Consultant</option>
                      <option value="admin">Admin</option>
                    </select>
                    {updatingRoleId === user.id && (
                      <div className="absolute right-2 top-1/2 -translate-y-1/2">
                        <div className="w-3 h-3 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin"></div>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => openDeleteModal(user.id, user.email)}
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