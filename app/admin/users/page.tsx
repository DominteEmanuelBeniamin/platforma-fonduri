/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { UserPlus, Trash2, X, Loader2, ChevronRight } from 'lucide-react'
import { useAuth } from '@/app/providers/AuthProvider'
import ConfirmDeleteModal from '@/components/ConfirmDeleteModal'
import { useToast } from '@/app/providers/ToastProvider'
import { LocationStrip } from '@/components/ui/LocationStrip'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { SearchInput } from '@/components/ui/SearchInput'
import { EmptyState } from '@/components/ui/EmptyState'
import { Plate } from '@/components/ui/Plate'
import { FloatingSurface, Scrim } from '@/components/ui/Surface'
import { formatDate } from '@/lib/signage'
import { Spinner } from '@/components/ui/Spinner'

type Rol = 'admin' | 'consultant' | 'client'

/** Rolul e o identitate, nu o stare. Nu primește culoare de semnal — verdele,
 *  chihlimbarul și roșul rămân rezervate pentru ce se întâmplă cu munca. */
const ROLURI: Record<Rol, string> = {
  client: 'Client (firmă)',
  consultant: 'Consultant',
  admin: 'Administrator',
}

/** Câmpul de formular: etichetă, ajutor vizibil și input. Ajutorul stă sub
 *  câmp, nu într-un tooltip care apare la hover — un indiciu pe care nu-l vezi
 *  cu tastatura și nu-l atingi cu degetul nu e ajutor. */
function Camp({
  label, required, hint, children,
}: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-ink">
        {label}{required && <span className="ml-0.5 text-[var(--sg-danger)]" aria-hidden="true">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-soft">{hint}</span>}
    </label>
  )
}

const inputClass =
  'h-11 w-full rounded-[var(--radius-plate)] border border-rule bg-plate px-3 text-sm text-ink ' +
  'placeholder:text-ink-faint transition-colors duration-[120ms] focus:border-[var(--sg-accent)] sm:h-10'

export default function AdminUsersPage() {
  const router = useRouter()
  const { loading: authLoading, token, apiFetch, profile } = useAuth()
  const { showToast, confirm } = useToast()

  const [users, setUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [updatingRoleId, setUpdatingRoleId] = useState<string | null>(null)

  // Căutare și filtrare — pagina e despre utilizatorii care există deja.
  const [cauta, setCauta] = useState('')
  const [filtruRol, setFiltruRol] = useState<Rol | 'toate'>('toate')

  // Formularul stă într-un panou, nu peste listă.
  const [panouDeschis, setPanouDeschis] = useState(false)
  const [newRole, setNewRole] = useState<Rol>('client')
  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newName, setNewName] = useState('')
  const [telefon, setTelefon] = useState('')
  const [cif, setCif] = useState('')
  const [numeFirma, setNumeFirma] = useState('')
  const [adresaFirma, setAdresaFirma] = useState('')
  const [persoanaContact, setPersoanaContact] = useState('')
  const [specializare, setSpecializare] = useState('')
  const [departament, setDepartament] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [userToDelete, setUserToDelete] = useState<{ id: string; email: string } | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const fetchUsers = useCallback(async () => {
    try {
      setLoading(true)
      const res = await apiFetch('/api/users')
      if (!res.ok) { showToast('Nu am putut încărca utilizatorii. Reîncearcă.', 'error'); return }
      const { users: data } = await res.json()
      setUsers(data)
    } finally {
      setLoading(false)
    }
  }, [apiFetch, showToast])

  useEffect(() => {
    if (authLoading) return
    if (!token) { router.replace('/login'); return }
    if (!profile) return
    if (profile.role !== 'admin') { router.replace('/'); return }
    fetchUsers()
  }, [authLoading, token, profile, router, fetchUsers])

  useEffect(() => {
    setCif(''); setNumeFirma(''); setAdresaFirma(''); setPersoanaContact('')
    setSpecializare(''); setDepartament('')
  }, [newRole])

  useEffect(() => {
    if (!panouDeschis) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPanouDeschis(false) }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [panouDeschis])

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsCreating(true)
    try {
      const payload: any = { email: newEmail, password: newPassword, role: newRole, fullName: newName, telefon: telefon || null }
      if (newRole === 'client') { payload.cif = cif || null; payload.numeFirma = numeFirma || null; payload.adresaFirma = adresaFirma || null; payload.persoanaContact = persoanaContact || null }
      else if (newRole === 'consultant') { payload.specializare = specializare || null; payload.departament = departament || null }
      else if (newRole === 'admin') { payload.departament = departament || null }

      const res = await apiFetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (!res.ok) throw new Error()

      showToast('Utilizatorul a fost creat.', 'success')
      setNewEmail(''); setNewPassword(''); setNewName(''); setTelefon('')
      setCif(''); setNumeFirma(''); setAdresaFirma(''); setPersoanaContact('')
      setSpecializare(''); setDepartament('')
      setPanouDeschis(false)
      fetchUsers()
    } catch {
      showToast('Nu am putut crea utilizatorul. Verifică datele și reîncearcă.', 'error')
    } finally {
      setIsCreating(false)
    }
  }

  const updateUserRole = async (user: { id: string; email: string; full_name?: string | null; role?: string }, rolNou: string) => {
    const rolVechi = ROLURI[(user.role as Rol) || 'client']
    // Descrierea numește persoana și direcția schimbării — un admin care
    // derulează rapid prin listă trebuie să vadă exact ce confirmă, nu o
    // propoziție generică pe care o apasă din reflex.
    if (!await confirm({
      title: 'Confirmă schimbarea rolului',
      description: `Rolul lui ${user.full_name || user.email} se schimbă din „${rolVechi}” în „${ROLURI[rolNou as Rol]}”.`,
      confirmText: 'Schimbă rolul',
    })) return
    setUpdatingRoleId(user.id)
    try {
      const res = await apiFetch(`/api/users/${user.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: rolNou }) })
      if (!res.ok) throw new Error()
      fetchUsers()
      showToast('Rolul utilizatorului a fost actualizat.', 'success')
    } catch {
      showToast('Nu am putut actualiza rolul. Reîncearcă.', 'error')
    } finally {
      setUpdatingRoleId(null)
    }
  }

  const handleConfirmDelete = async () => {
    if (!userToDelete) return
    setIsDeleting(true)
    try {
      const res = await apiFetch(`/api/users/${userToDelete.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      setDeleteModalOpen(false)
      setUserToDelete(null)
      fetchUsers()
    } catch {
      showToast('Nu am putut șterge utilizatorul. Reîncearcă.', 'error')
    } finally {
      setIsDeleting(false)
    }
  }

  const peRol = useMemo(() => {
    const c: Record<string, number> = { admin: 0, consultant: 0, client: 0 }
    for (const u of users) c[u.role as string] = (c[u.role as string] ?? 0) + 1
    return c
  }, [users])

  const filtrati = useMemo(() => {
    const q = cauta.trim().toLowerCase()
    return users.filter((u) => {
      if (filtruRol !== 'toate' && u.role !== filtruRol) return false
      if (!q) return true
      return `${u.email ?? ''} ${u.full_name ?? ''}`.toLowerCase().includes(q)
    })
  }, [users, cauta, filtruRol])

  if (authLoading || loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center" role="status" aria-live="polite">
        <Spinner size="md" />
        <span className="sr-only">Se încarcă utilizatorii…</span>
      </div>
    )
  }

  return (
    <div>
      <ConfirmDeleteModal
        isOpen={deleteModalOpen}
        onClose={() => { setDeleteModalOpen(false); setUserToDelete(null) }}
        onConfirm={handleConfirmDelete}
        title="Șterge utilizator"
        description={`Ștergi definitiv utilizatorul „${userToDelete?.email}”? Acțiunea nu poate fi anulată.`}
        confirmText="Șterge utilizator"
        confirmWord="sterge"
        loading={isDeleting}
      />

      <LocationStrip
        segments={[{ label: 'Bonie', href: '/' }, { label: 'Utilizatori' }]}
        action={
          <Button variant="primary" aria-label="Adaugă utilizator" onClick={() => setPanouDeschis(true)}>
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Adaugă utilizator</span>
          </Button>
        }
      />

      <h1 className="text-3xl font-bold tracking-tight text-ink md:text-4xl">Utilizatori</h1>
      <p className="mt-2 text-sm text-ink-soft">
        {users.length} {users.length === 1 ? 'cont' : 'conturi'} · {peRol.client} clienți, {peRol.consultant} consultanți, {peRol.admin} administratori
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-2 border-b border-rule pb-3">
        <div className="min-w-[220px] flex-1">
          <SearchInput value={cauta} onChange={setCauta} placeholder="Caută după email sau nume…" label="Caută utilizatori" />
        </div>
        {/* `flex-wrap`: la 320px cele patru filtre nu încap pe un rând, iar
            `overflow-x-hidden` de pe `body` le-ar tăia în tăcere pe ultimul.
            DESIGN.md cere ruperea în rânduri, nu derularea. */}
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filtrează după rol">
          {(['toate', 'client', 'consultant', 'admin'] as const).map((r) => (
            <Button
              key={r}
              variant="secondary"
              size="sm"
              aria-pressed={filtruRol === r}
              onClick={() => setFiltruRol(r)}
              className={filtruRol === r ? 'border-[var(--sg-accent)] bg-[var(--sg-accent-soft)] text-[var(--sg-accent-ink)]' : ''}
            >
              {r === 'toate' ? 'Toate' : ROLURI[r].replace(' (firmă)', '')}
            </Button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2 pb-10">
        {filtrati.length === 0 ? (
          <EmptyState
            title={users.length === 0 ? 'Niciun utilizator' : 'Niciun utilizator nu se potrivește'}
            action={users.length === 0
              ? <Button variant="primary" onClick={() => setPanouDeschis(true)}><UserPlus className="h-4 w-4" aria-hidden="true" /> Adaugă utilizator</Button>
              : <Button variant="secondary" onClick={() => { setCauta(''); setFiltruRol('toate') }}>Șterge filtrele</Button>}
          >
            {users.length === 0
              ? 'Primul cont deschide platforma pentru cineva: un client, un consultant sau un administrator.'
              : 'Încearcă alt termen de căutare, sau alege alt rol.'}
          </EmptyState>
        ) : (
          filtrati.map((user) => (
            <Plate key={user.id} interactive className="group">
              <div className="flex flex-wrap items-center gap-3 p-4 sm:flex-nowrap">
                <button
                  onClick={() => router.push(`/admin/users/${user.id}`)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-ink transition-colors duration-[120ms] group-hover:text-[var(--sg-accent)]">
                      {user.email}
                    </span>
                    <span className="mt-0.5 block truncate text-sm text-ink-soft">
                      {user.full_name || 'Fără nume'} · cont din {formatDate(user.created_at)}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint transition-colors duration-[120ms] group-hover:text-[var(--sg-accent)]" aria-hidden="true" />
                </button>

                <div className="flex shrink-0 items-center gap-2">
                  <label className="sr-only" htmlFor={`rol-${user.id}`}>Rolul lui {user.email}</label>
                  <select
                    id={`rol-${user.id}`}
                    value={user.role || 'client'}
                    onChange={e => updateUserRole(user, e.target.value)}
                    disabled={updatingRoleId === user.id}
                    className="h-11 rounded-[var(--radius-plate)] border border-rule bg-plate px-2 text-sm text-ink transition-colors duration-[120ms] focus:border-[var(--sg-accent)] disabled:opacity-55 sm:h-9"
                  >
                    <option value="client">Client</option>
                    <option value="consultant">Consultant</option>
                    <option value="admin">Administrator</option>
                  </select>
                  {updatingRoleId === user.id && <Loader2 className="h-4 w-4 animate-spin text-ink-soft" aria-hidden="true" />}
                  <IconButton
                    label={`Șterge utilizatorul ${user.email}`}
                    tone="danger"
                    onClick={() => { setUserToDelete({ id: user.id, email: user.email }); setDeleteModalOpen(true) }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </IconButton>
                </div>
              </div>
            </Plate>
          ))
        )}
      </div>

      {panouDeschis && (
        <div className="fixed inset-0 z-[100] flex justify-end">
          <Scrim onClick={() => setPanouDeschis(false)} />
          <FloatingSurface
            role="dialog"
            ariaModal
            ariaLabel="Adaugă utilizator"
            className="drawer-slide-in relative flex h-full w-full flex-col border-y-0 border-r-0 sm:max-w-lg"
          >
            <div className="flex items-center justify-between border-b border-rule px-5 py-4">
              <h2 className="text-base font-bold text-ink">Adaugă utilizator</h2>
              <IconButton label="Închide panoul" onClick={() => setPanouDeschis(false)}><X className="h-4 w-4" /></IconButton>
            </div>

            <form onSubmit={handleCreateUser} className="flex min-h-0 flex-1 flex-col">
              <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
                <fieldset>
                  <legend className="mb-2 text-sm font-semibold text-ink">Tip de cont</legend>
                  <div className="flex flex-col gap-1">
                    {(['client', 'consultant', 'admin'] as const).map((rol) => (
                      <label key={rol} className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-[var(--radius-plate)] px-2 transition-colors duration-[120ms] hover:bg-paper-sunk">
                        <input
                          type="radio"
                          name="rol"
                          value={rol}
                          checked={newRole === rol}
                          onChange={() => setNewRole(rol)}
                          className="h-4 w-4"
                        />
                        <span className="text-sm text-ink">{ROLURI[rol]}</span>
                      </label>
                    ))}
                  </div>
                  {newRole === 'admin' && (
                    <p className="mt-2 text-xs leading-relaxed text-ink-soft">
                      Administratorii văd și pot schimba tot: proiecte, utilizatori, șabloane și jurnalul de audit.
                    </p>
                  )}
                </fieldset>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Camp label="Email" required>
                    <input type="email" required placeholder="user@firma.ro" value={newEmail} onChange={e => setNewEmail(e.target.value)} className={inputClass} />
                  </Camp>
                  <Camp label="Nume complet" required>
                    <input type="text" required placeholder="Ion Popescu" value={newName} onChange={e => setNewName(e.target.value)} className={inputClass} />
                  </Camp>
                  <Camp label="Parolă temporară" required hint="O comunici tu utilizatorului; el o schimbă la prima autentificare.">
                    <input type="text" required placeholder="parola123" value={newPassword} onChange={e => setNewPassword(e.target.value)} className={inputClass} />
                  </Camp>
                  <Camp label="Telefon">
                    <input type="tel" placeholder="0740123456" value={telefon} onChange={e => setTelefon(e.target.value)} className={inputClass} />
                  </Camp>
                </div>

                <fieldset className="border-t border-rule pt-5">
                  <legend className="sr-only">Detalii pentru {ROLURI[newRole]}</legend>
                  <p className="mb-3 text-sm font-semibold text-ink">Detalii pentru {ROLURI[newRole].toLowerCase()}</p>

                  {newRole === 'client' && (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <Camp label="CIF / CUI" required hint="Ex.: RO12345678">
                        <input type="text" required placeholder="RO12345678" value={cif} onChange={e => setCif(e.target.value)} className={inputClass} />
                      </Camp>
                      <Camp label="Nume firmă" required>
                        <input type="text" required placeholder="SC TECH SOLUTIONS SRL" value={numeFirma} onChange={e => setNumeFirma(e.target.value)} className={inputClass} />
                      </Camp>
                      <div className="sm:col-span-2">
                        <Camp label="Adresă firmă">
                          <input type="text" placeholder="Str. Principală nr. 10, București" value={adresaFirma} onChange={e => setAdresaFirma(e.target.value)} className={inputClass} />
                        </Camp>
                      </div>
                      <div className="sm:col-span-2">
                        <Camp label="Persoană de contact" hint="Completeaz-o doar dacă diferă de titularul contului.">
                          <input type="text" placeholder="Ana Popescu" value={persoanaContact} onChange={e => setPersoanaContact(e.target.value)} className={inputClass} />
                        </Camp>
                      </div>
                    </div>
                  )}

                  {newRole === 'consultant' && (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <Camp label="Specializare" required hint="Ex.: PNRR, Digitalizare IMM">
                        <input type="text" required placeholder="Digitalizare IMM, PNRR" value={specializare} onChange={e => setSpecializare(e.target.value)} className={inputClass} />
                      </Camp>
                      <Camp label="Departament">
                        <input type="text" placeholder="Departament Proiecte" value={departament} onChange={e => setDepartament(e.target.value)} className={inputClass} />
                      </Camp>
                    </div>
                  )}

                  {newRole === 'admin' && (
                    <Camp label="Departament">
                      <input type="text" placeholder="Management, IT" value={departament} onChange={e => setDepartament(e.target.value)} className={inputClass} />
                    </Camp>
                  )}
                </fieldset>
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-rule px-5 py-4">
                <p className="min-w-0 truncate text-sm text-ink-soft">
                  Creezi <span className="font-semibold text-ink">{newName || 'un cont nou'}</span> ca {ROLURI[newRole].toLowerCase()}.
                </p>
                <Button type="submit" variant="primary" disabled={isCreating}>
                  {isCreating
                    ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Se creează…</>
                    : <><UserPlus className="h-4 w-4" aria-hidden="true" /> Creează</>}
                </Button>
              </div>
            </form>
          </FloatingSurface>
        </div>
      )}
    </div>
  )
}
