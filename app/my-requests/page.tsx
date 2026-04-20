/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/app/providers/AuthProvider'
import {
  FileText,
  Clock,
  AlertTriangle,
  Mail,
  ArrowLeft,
  CheckCircle2,
  Check,
} from 'lucide-react'
import {
  getReminderType,
  generateMailtoLink,
  REMINDER_LABELS,
  REMINDER_BADGE,
} from '@/lib/document-reminder'

export default function MyRequestsPage() {
  const router = useRouter()
  const { loading: authLoading, token, apiFetch, profile } = useAuth()
  const [requests, setRequests] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  useEffect(() => {
    if (authLoading) return
    if (!token) { router.push('/login'); return }
    if (profile?.role === 'client') { router.push('/'); return }

    apiFetch('/api/my-document-requests')
      .then(r => r.json())
      .then(d => setRequests(d.requests ?? []))
      .catch(console.error)
      .finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, token, profile?.role])

  const toggleReminder = async (reqId: string) => {
    if (togglingId === reqId) return
    setTogglingId(reqId)
    try {
      const res = await apiFetch(`/api/document-requests/${reqId}/reminder`, { method: 'POST' })
      const json = await res.json()
      if (res.ok) {
        setRequests(prev =>
          prev.map(r => r.id === reqId ? { ...r, reminder_sent_at: json.reminder_sent_at } : r)
        )
      }
    } finally {
      setTogglingId(null)
    }
  }

  if (loading || authLoading) {
    return (
      <div className="flex h-[80vh] items-center justify-center">
        <div className="w-10 h-10 border-4 border-slate-100 border-t-indigo-600 rounded-full animate-spin" />
      </div>
    )
  }

  const overdue = requests.filter((r: any) => {
    const d = r.deadline_at ? new Date(r.deadline_at) : null
    d?.setHours(0, 0, 0, 0)
    return d && d < today
  })
  const upcoming = requests.filter((r: any) => {
    const d = r.deadline_at ? new Date(r.deadline_at) : null
    d?.setHours(0, 0, 0, 0)
    return d && d >= today
  })
  const noDeadline = requests.filter((r: any) => !r.deadline_at)

  const groups = [
    { key: 'overdue', label: 'Expirate', items: overdue, accent: 'text-red-500', dot: 'bg-red-400' },
    { key: 'upcoming', label: 'Upcoming', items: upcoming, accent: 'text-amber-600', dot: 'bg-amber-400' },
    { key: 'none', label: 'Fără termen', items: noDeadline, accent: 'text-slate-500', dot: 'bg-slate-300' },
  ].filter(g => g.items.length > 0)

  return (
    <div className="flex flex-col gap-8 fade-in-up">
      {/* Header */}
      <div className="flex items-center gap-4 pb-6 border-b border-slate-200/60">
        <Link href="/">
          <button className="w-9 h-9 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 flex items-center justify-center transition-colors shadow-sm">
            <ArrowLeft className="w-4 h-4 text-slate-500" />
          </button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Cereri de documente</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {requests.length === 0
              ? 'Nicio cerere activă'
              : `${requests.length} cereri în așteptare${overdue.length > 0 ? ` · ${overdue.length} expirate` : ''}`}
          </p>
        </div>
        {overdue.length > 0 && (
          <span className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full bg-red-50 text-red-500 border border-red-100">
            <AlertTriangle className="w-3 h-3" />
            {overdue.length} expirate
          </span>
        )}
      </div>

      {/* Empty */}
      {requests.length === 0 ? (
        <div className="py-24 flex flex-col items-center justify-center text-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center mb-2">
            <CheckCircle2 className="w-7 h-7 text-indigo-300" />
          </div>
          <p className="text-base font-bold text-slate-700">Totul e la zi!</p>
          <p className="text-sm text-slate-400">Nu ai cereri de documente în așteptare.</p>
          <Link href="/">
            <button className="mt-4 px-4 py-2 text-sm font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors">
              Înapoi la dashboard
            </button>
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {groups.map(group => (
            <div key={group.key}>
              {/* Group label */}
              <div className="flex items-center gap-2 mb-3">
                <span className={`w-2 h-2 rounded-full ${group.dot}`} />
                <span className={`text-xs font-bold uppercase tracking-wider ${group.accent}`}>
                  {group.label}
                </span>
                <span className="text-xs text-slate-400 font-medium">({group.items.length})</span>
              </div>

              {/* Cards */}
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm divide-y divide-slate-50">
                {group.items.map((req: any) => {
                  const reminderType = getReminderType(req.deadline_at) ?? '1_week'
                  const badge = REMINDER_BADGE[reminderType]
                  const mailtoLink = req.client_email
                    ? generateMailtoLink(
                        {
                          requestName: req.name,
                          requestDescription: req.description,
                          deadlineAt: req.deadline_at,
                          clientEmail: req.client_email,
                          clientName: req.client_name,
                          projectTitle: req.project_title ?? '',
                          projectId: req.project_id,
                        },
                        reminderType
                      )
                    : null

                  const deadline = req.deadline_at ? new Date(req.deadline_at) : null
                  deadline?.setHours(0, 0, 0, 0)
                  const isOverdue = deadline && deadline < today
                  const isSoon =
                    deadline &&
                    !isOverdue &&
                    deadline.getTime() - today.getTime() <= 3 * 24 * 60 * 60 * 1000

                  const accentColor = isOverdue
                    ? 'bg-red-400'
                    : reminderType === 'same_day'
                    ? 'bg-orange-400'
                    : reminderType === '1_day'
                    ? 'bg-orange-300'
                    : reminderType === '3_days'
                    ? 'bg-amber-300'
                    : 'bg-slate-200'

                  const rowBg = isOverdue ? 'bg-red-50/30 hover:bg-red-50/50' : 'hover:bg-slate-50/60'

                  return (
                    <div
                      key={req.id}
                      className={`relative flex items-center gap-4 pl-4 pr-5 py-4 transition-colors ${rowBg}`}
                    >
                      {/* Accent bar */}
                      <div className={`absolute left-0 top-0 bottom-0 w-[3px] ${accentColor}`} />

                      {/* Icon */}
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                        isOverdue ? 'bg-red-100' : 'bg-slate-100'
                      }`}>
                        {isOverdue
                          ? <AlertTriangle className="w-4 h-4 text-red-400" />
                          : <FileText className="w-4 h-4 text-slate-400" />
                        }
                      </div>

                      {/* Text */}
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-semibold truncate ${isOverdue ? 'text-red-700' : 'text-slate-800'}`}>
                          {req.name}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <Link href={`/projects/${req.project_id}`}>
                            <span className="text-[11px] text-indigo-400 hover:text-indigo-600 hover:underline">
                              {req.project_title}
                            </span>
                          </Link>
                          {req.client_name && (
                            <>
                              <span className="text-[11px] text-slate-200">·</span>
                              <span className="text-[11px] text-slate-400">{req.client_name}</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Deadline */}
                      {deadline ? (
                        <div className={`hidden sm:flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-md flex-shrink-0 ${
                          isOverdue
                            ? 'bg-red-100 text-red-600'
                            : isSoon
                            ? 'bg-amber-50 text-amber-600'
                            : 'bg-slate-100 text-slate-500'
                        }`}>
                          <Clock className="w-2.5 h-2.5" />
                          {deadline.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </div>
                      ) : (
                        <span className="hidden sm:block text-[11px] text-slate-300 flex-shrink-0">Fără termen</span>
                      )}

                      {/* Status */}
                      <span className={`hidden md:inline-flex flex-shrink-0 text-[10px] font-bold px-2.5 py-1 rounded-md ${
                        req.status === 'review'
                          ? 'bg-blue-50 text-blue-500'
                          : 'bg-amber-50 text-amber-600'
                      }`}>
                        {req.status === 'review' ? 'Verificare' : 'Așteaptă'}
                      </span>

                      {/* Reminder */}
                      {mailtoLink ? (
                        <a
                          href={mailtoLink}
                          title={REMINDER_LABELS[reminderType]}
                          className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all hover:shadow-sm active:scale-95 ${badge.bg} ${badge.text} ${badge.border}`}
                        >
                          <Mail className="w-3.5 h-3.5" />
                          Reminder
                        </a>
                      ) : (
                        <div
                          title="Fără email client"
                          className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-slate-200 text-xs font-medium text-slate-300 cursor-not-allowed"
                        >
                          <Mail className="w-3.5 h-3.5" />
                          Reminder
                        </div>
                      )}

                      {/* Sent checkbox */}
                      <button
                        onClick={() => toggleReminder(req.id)}
                        disabled={togglingId === req.id}
                        title={req.reminder_sent_at
                          ? `Trimis pe ${new Date(req.reminder_sent_at).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' })} — apasă pentru a anula`
                          : 'Marchează ca trimis'}
                        className={`flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-all active:scale-95 ${
                          req.reminder_sent_at
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-600 hover:bg-emerald-100'
                            : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-500'
                        } ${togglingId === req.id ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                      >
                        <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-all ${
                          req.reminder_sent_at
                            ? 'bg-emerald-500 border-emerald-500'
                            : 'border-slate-300'
                        }`}>
                          {req.reminder_sent_at && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
                        </div>
                        <span className="hidden sm:inline">
                          {req.reminder_sent_at ? 'Trimis' : 'Trimis?'}
                        </span>
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
