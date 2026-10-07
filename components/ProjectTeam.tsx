'use client'

import { useCallback, useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Loader2, UserMinus, UserPlus, Users, X } from 'lucide-react'
import { useAuth } from '@/app/providers/AuthProvider'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'

type Person = { id: string; full_name: string | null; email: string }

type Member = {
  id: string
  consultant_id: string
  profiles: (Person & { consultant_level?: string | null }) | null
}

function initials(name: string | null | undefined, email: string | null | undefined) {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (email ?? '?').charAt(0).toUpperCase()
}

/** Motivul pentru care baza a refuzat scoaterea, spus pe românește. */
function removalError(reason: string | undefined) {
  if (reason === 'general_consultant') return 'Consultantul răspunde de cererile generale. Alege altă persoană pentru ele, apoi încearcă din nou.'
  // Atribuirile pe elemente finalizate blochează și ele (issue separat, D15), iar
  // acelea pot fi ascunse în pagină: mesajul spune unde să le cauți (#109).
  if (reason === 'assigned_activity') return 'Consultantul are activități atribuite în proiect, poate și finalizate (ascunse implicit). Atribuie-le altcuiva, apoi încearcă din nou.'
  // O cerere închisă nu se poate reatribui (D13): mesajul spune ocolul din plan.
  if (reason === 'assigned_request') return 'Consultantul are cereri de documente atribuite, poate și închise sau aprobate (ascunse implicit). Atribuie-le altcuiva (o cerere închisă se redeschide întâi), apoi încearcă din nou.'
  if (reason === 'blocked') return 'Consultantul are încă lucruri atribuite în proiect, poate și finalizate (ascunse implicit). Atribuie-le altcuiva, apoi încearcă din nou.'
  if (reason === 'senior') return 'Un consultant senior nu poate scoate alt senior. Cere unui administrator.'
  if (reason === 'self') return 'Nu te poți scoate singur din echipă. Cere unui administrator.'
  return 'Nu am putut scoate membrul din echipă. Reîncearcă.'
}

/**
 * Echipa proiectului, din bara de sus: un buton cu inițialele membrilor care
 * deschide un panou lateral. Adminul și consultantul senior membru adaugă și
 * scot oameni; ceilalți consultanți văd doar cine lucrează pe dosar.
 */
export default function ProjectTeam({
  projectId,
  members,
  canManage,
  canRemoveAny,
  onChange,
}: {
  projectId: string
  /** Membrii pe care pagina îi are deja, ca butonul să apară fără încă o cerere. */
  members: Person[]
  canManage: boolean
  /** Adminul scoate pe oricine; seniorul doar juniori, și nu pe el însuși. */
  canRemoveAny: boolean
  onChange: () => void
}) {
  const { apiFetch, userId } = useAuth()

  const [open, setOpen] = useState(false)
  const [team, setTeam] = useState<Member[]>([])
  const [available, setAvailable] = useState<Person[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedId, setSelectedId] = useState('')
  const [adding, setAdding] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  // Confirmarea stă în rândul membrului: un al doilea dialog peste panou ar fi
  // blocat de panoul modal, iar un toast s-ar pierde sub el.
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null)
  const [addError, setAddError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [membersRes, availRes] = await Promise.all([
        apiFetch(`/api/projects/${projectId}/members`),
        canManage ? apiFetch(`/api/projects/${projectId}/available-consultants`) : Promise.resolve(null),
      ])
      if (membersRes.ok) setTeam((await membersRes.json()).members ?? [])
      if (availRes?.ok) setAvailable((await availRes.json()).consultants ?? [])
    } catch (error) {
      console.error('Echipa proiectului nu s-a încărcat:', error)
    } finally {
      setLoading(false)
    }
  }, [apiFetch, projectId, canManage])

  useEffect(() => {
    if (open) void load()
    if (!open) {
      setConfirmingId(null)
      setRowError(null)
      setAddError(null)
    }
  }, [open, load])

  const addMember = async () => {
    if (!selectedId) return
    setAdding(true)
    setAddError(null)
    try {
      const res = await apiFetch(`/api/projects/${projectId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consultant_id: selectedId }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.member) throw new Error()
      setTeam(prev => [...prev, json.member])
      setAvailable(prev => prev.filter(c => c.id !== selectedId))
      setSelectedId('')
      onChange()
    } catch {
      setAddError('Nu am putut adăuga consultantul în echipă. Reîncearcă.')
    } finally {
      setAdding(false)
    }
  }

  const removeMember = async (member: Member) => {
    setRemovingId(member.id)
    setRowError(null)
    try {
      const res = await apiFetch(`/api/projects/${projectId}/members/${member.id}`, { method: 'DELETE' })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        setRowError({ id: member.id, message: removalError(json?.reason) })
        return
      }
      setTeam(prev => prev.filter(m => m.id !== member.id))
      if (member.profiles) setAvailable(prev => [...prev, member.profiles!])
      onChange()
    } catch {
      setRowError({ id: member.id, message: 'Nu am putut scoate membrul din echipă. Reîncearcă.' })
    } finally {
      setRemovingId(null)
      setConfirmingId(null)
    }
  }

  const preview = members.slice(0, 3)
  const count = members.length

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button variant="secondary" size="sm" aria-label={`Echipa proiectului, ${count} ${count === 1 ? 'membru' : 'membri'}`}>
          {preview.length > 0 ? (
            <span className="flex gap-0.5" aria-hidden="true">
              {preview.map(person => (
                <span
                  key={person.id}
                  className="flex h-6 w-6 items-center justify-center rounded-[1px] bg-paper-sunk text-[10px] font-bold text-ink-soft"
                >
                  {initials(person.full_name, person.email)}
                </span>
              ))}
            </span>
          ) : (
            <Users className="h-4 w-4" aria-hidden="true" />
          )}
          <span className="hidden sm:inline">Echipa</span>
          <span className="tabular-nums text-ink-soft" aria-hidden="true">{count}</span>
        </Button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[999999]" style={{ backgroundColor: 'rgb(22 24 28 / 0.45)' }} />
        <Dialog.Content
          className="fixed inset-y-0 right-0 z-[999999] flex w-full flex-col border-l border-rule bg-plate focus:outline-none sm:w-[26rem]"
          style={{ boxShadow: 'var(--sg-lift)' }}
        >
          <div className="flex items-start justify-between gap-3 border-b border-rule px-5 py-4 pt-[max(1rem,env(safe-area-inset-top))]">
            <div className="min-w-0">
              <Dialog.Title className="text-lg font-bold text-ink">Echipa proiectului</Dialog.Title>
              <Dialog.Description className="mt-0.5 text-sm text-ink-soft">
                {canManage
                  ? 'Cine lucrează pe dosar. Poți adăuga și scoate consultanți.'
                  : 'Cine lucrează pe dosar.'}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <IconButton label="Închide">
                <X className="h-4 w-4" />
              </IconButton>
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading && team.length === 0 ? (
              <p className="flex items-center gap-2 px-5 py-6 text-sm text-ink-soft" role="status">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Se încarcă echipa…
              </p>
            ) : team.length === 0 ? (
              <p className="px-5 py-6 text-sm text-ink-soft">Nu e încă nimeni în echipă.</p>
            ) : (
              <ul className="divide-y divide-rule">
                {team.map(member => {
                  const person = member.profiles
                  const isSelf = member.consultant_id === userId
                  const name = person?.full_name || person?.email || 'consultantul'
                  const confirming = confirmingId === member.id
                  const error = rowError?.id === member.id ? rowError.message : null
                  return (
                    <li key={member.id} className={`px-5 py-3 ${confirming ? 'bg-[var(--sg-danger-soft)]' : ''}`}>
                      <div className="flex items-center gap-3">
                        <span
                          aria-hidden="true"
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-plate)] bg-paper-sunk text-xs font-bold text-ink-soft"
                        >
                          {initials(person?.full_name, person?.email)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-sm font-semibold text-ink">{person?.full_name || person?.email || 'Consultant'}</span>
                            {person?.consultant_level === 'senior' && (
                              <span className="shrink-0 rounded-[var(--radius-plate)] border border-rule-strong px-1.5 text-[11px] font-semibold text-ink-soft">Senior</span>
                            )}
                            {isSelf && (
                              <span className="shrink-0 rounded-[var(--radius-plate)] border border-rule px-1.5 text-[11px] font-semibold text-ink-soft">tu</span>
                            )}
                          </span>
                          {person?.full_name && <span className="block truncate text-xs text-ink-soft">{person.email}</span>}
                        </span>
                        {canManage && !confirming && (canRemoveAny || (!isSelf && person?.consultant_level !== 'senior')) && (
                          <IconButton
                            label={`Scoate pe ${name} din echipă`}
                            tone="danger"
                            disabled={removingId !== null}
                            onClick={() => { setConfirmingId(member.id); setRowError(null) }}
                          >
                            <UserMinus className="h-4 w-4" />
                          </IconButton>
                        )}
                      </div>
                      {confirming && (
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 pl-12" role="group" aria-label="Confirmă scoaterea din echipă">
                          <p className="text-sm text-ink">
                            {isSelf ? 'Te scoți din echipă? Nu vei mai avea acces la proiect.' : `Scoți pe ${name}? Nu va mai avea acces la proiect.`}
                          </p>
                          <div className="flex gap-2">
                            <Button size="sm" variant="quiet" disabled={removingId !== null} onClick={() => setConfirmingId(null)}>Anulează</Button>
                            <Button size="sm" variant="danger" disabled={removingId !== null} onClick={() => { void removeMember(member) }}>
                              {removingId === member.id && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                              Scoate din echipă
                            </Button>
                          </div>
                        </div>
                      )}
                      {error && (
                        <p role="alert" className="mt-2 pl-12 text-sm font-semibold text-[var(--sg-danger)]">{error}</p>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <div className="border-t border-rule bg-paper px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {canManage ? (
              <>
                <label htmlFor="echipa-adauga" className="text-sm font-semibold text-ink">Adaugă în echipă</label>
                {!loading && available.length === 0 ? (
                  <p className="mt-1 text-sm text-ink-soft">Toți consultanții sunt deja în echipă.</p>
                ) : (
                  <div className="mt-1.5 flex gap-2">
                    <select
                      id="echipa-adauga"
                      value={selectedId}
                      disabled={loading || adding}
                      onChange={e => setSelectedId(e.target.value)}
                      className={`block min-h-11 min-w-0 flex-1 rounded-[var(--radius-plate)] border border-rule-strong bg-plate px-3 text-sm transition-colors duration-[120ms] hover:border-ink-faint focus:border-[var(--sg-accent)] disabled:opacity-55 pointer-fine:min-h-10 ${selectedId ? 'text-ink' : 'text-ink-soft'}`}
                    >
                      <option value="">{loading ? 'Se încarcă…' : 'Alege un consultant'}</option>
                      {available.map(c => (
                        <option key={c.id} value={c.id}>{c.full_name || c.email}</option>
                      ))}
                    </select>
                    <Button variant="primary" disabled={!selectedId || adding} onClick={() => { void addMember() }}>
                      {adding ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <UserPlus className="h-4 w-4" aria-hidden="true" />}
                      Adaugă
                    </Button>
                  </div>
                )}
                {addError && <p role="alert" className="mt-2 text-sm font-semibold text-[var(--sg-danger)]">{addError}</p>}
              </>
            ) : (
              <p className="text-sm text-ink-soft">Echipa o schimbă un administrator sau un consultant senior din echipă.</p>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
