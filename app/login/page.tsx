'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/app/providers/AuthProvider'
import { Eye, EyeOff } from 'lucide-react'
import { useToast } from '@/app/providers/ToastProvider'

export default function LoginPage() {
  const router = useRouter()
  const { loading: authInitLoading, token } = useAuth()
  const { showToast } = useToast()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [authLoading, setAuthLoading] = useState(false)
  const [forgotPassword, setForgotPassword] = useState(false)
  const [forgotLoading, setForgotLoading] = useState(false)
  const [forgotStatus, setForgotStatus] = useState<'success' | 'error' | null>(null)

  // Redirect dacă e deja logat
  useEffect(() => {
    if (authInitLoading) return
    if (token) router.replace('/')
  }, [authInitLoading, token, router])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setAuthLoading(true)

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })

      if (error) {
        showToast('Autentificarea a eșuat. Verifică emailul și parola.', 'error')
        return
      }

      // Înregistrăm audit log pentru login
      if (data.session?.access_token) {
        try {
          await fetch('/api/auth/audit', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${data.session.access_token}`
            },
            body: JSON.stringify({ action: 'login' })
          })
        } catch (auditError) {
          // Nu blocăm login-ul dacă audit-ul eșuează
          console.warn('Audit logging failed:', auditError)
        }
      }

      router.replace('/')
    } finally {
      setAuthLoading(false)
    }
  }

  const handlePasswordResetRequest = async (e: React.FormEvent) => {
    e.preventDefault()
    if (forgotLoading) return

    setForgotLoading(true)
    setForgotStatus(null)

    try {
      const response = await fetch('/api/auth/password-reset-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })

      if (response.ok) {
        setForgotStatus('success')
      } else {
        setForgotStatus('error')
      }
    } catch {
      setForgotStatus('error')
    } finally {
      setForgotLoading(false)
    }
  }

  const showLoginForm = () => {
    setForgotPassword(false)
    setForgotStatus(null)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="w-full max-w-md">
        <div className="bg-white p-10 rounded-3xl shadow-xl border border-slate-200">
          <div className="text-center mb-8">
            <div className="w-12 h-12 bg-slate-900 rounded-xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-slate-900/20">
              <span className="text-white font-bold text-lg">B</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Bine ai venit</h1>
            <p className="text-slate-500 mt-2 text-sm">Autentifică-te pentru a accesa platforma.</p>
          </div>

          {forgotPassword ? (
            <form onSubmit={handlePasswordResetRequest} className="space-y-5">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Solicită schimbarea parolei</h2>
                <p className="mt-2 text-sm text-slate-500">
                  Introdu adresa de email asociată contului. Un administrator va verifica solicitarea,
                  va seta manual o parolă nouă și ți-o va comunica. Schimbarea nu este automată.
                </p>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="reset-email" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider ml-1">Email</label>
                <input
                  id="reset-email"
                  type="email"
                  required
                  value={email}
                  onChange={e => { setEmail(e.target.value); setForgotStatus(null) }}
                  autoComplete="email"
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all duration-200 [&:-webkit-autofill]:shadow-[0_0_0_1000px_#f8fafc_inset] [&:-webkit-autofill]:-webkit-text-fill-color-slate-900"
                  placeholder="nume@companie.ro"
                />
              </div>

              {forgotStatus && (
                <p
                  role={forgotStatus === 'error' ? 'alert' : 'status'}
                  aria-live="polite"
                  className={`text-sm ${forgotStatus === 'error' ? 'text-red-600' : 'text-emerald-600'}`}
                >
                  {forgotStatus === 'success'
                    ? 'Dacă există un cont asociat acestei adrese, administratorii au primit solicitarea. Un administrator va seta manual parola nouă și ți-o va comunica.'
                    : 'Nu am putut trimite solicitarea acum. Încearcă din nou mai târziu.'}
                </p>
              )}

              {forgotStatus !== 'success' && (
                <button
                  type="submit"
                  disabled={forgotLoading}
                  className="w-full py-3.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-semibold shadow-lg shadow-slate-900/20 active:scale-[0.98] transition-all duration-200 disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {forgotLoading ? 'Se trimite...' : 'Trimite solicitarea administratorilor'}
                </button>
              )}

              <button
                type="button"
                onClick={showLoginForm}
                disabled={forgotLoading}
                className="w-full text-sm font-semibold text-slate-600 hover:text-slate-900 transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
              >
                Înapoi la autentificare
              </button>
            </form>
          ) : (
          <form onSubmit={handleLogin} className="space-y-5">
            <div className="space-y-1.5">
              <label htmlFor="login-email" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider ml-1">Email</label>
              {/* Am adăugat clasele [&:-webkit-autofill] pentru a scoate fundalul galben urât din Chrome */}
              <input
                id="login-email"
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoComplete="email"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all duration-200 [&:-webkit-autofill]:shadow-[0_0_0_1000px_#f8fafc_inset] [&:-webkit-autofill]:-webkit-text-fill-color-slate-900"
                placeholder="nume@companie.ro"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="login-password" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider ml-1">Parolă</label>
              <div className="relative">
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password"
                  // Padding-right (pr-12) este esențial ca textul să nu intre sub iconiță
                  className="w-full px-4 py-3 pr-12 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all duration-200 [&:-webkit-autofill]:shadow-[0_0_0_1000px_#f8fafc_inset] [&:-webkit-autofill]:-webkit-text-fill-color-slate-900"
                  placeholder="••••••••"
                />
                
                {/* BUTTON FIX: 
                    1. z-10: Asigură că stă DEASUPRA input-ului (chiar și peste autofill).
                    2. cursor-pointer: Feedback vizual la hover.
                    3. right-3: O poziționare ușor mai relaxată decât right-4.
                */}
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Ascunde parola' : 'Afișează parola'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors duration-200 z-10 cursor-pointer p-1"
                >
                  {showPassword ? (
                    <EyeOff className="w-5 h-5" />
                  ) : (
                    <Eye className="w-5 h-5" />
                  )}
                </button>
              </div>
              <button
                type="button"
                onClick={() => { setPassword(''); setShowPassword(false); setForgotPassword(true); setForgotStatus(null) }}
                className="text-sm font-semibold text-indigo-600 hover:text-indigo-800 transition-colors"
              >
                Am uitat parola
              </button>
            </div>

            <button
              type="submit"
              disabled={authLoading}
              className="w-full py-3.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-semibold shadow-lg shadow-slate-900/20 active:scale-[0.98] transition-all duration-200 disabled:opacity-70 disabled:cursor-not-allowed mt-2"
            >
              {authLoading ? 'Se conectează...' : 'Intră în cont'}
            </button>
          </form>
          )}
        </div>
      </div>
    </div>
  )
}
