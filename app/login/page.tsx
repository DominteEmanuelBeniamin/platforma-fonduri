'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/app/providers/AuthProvider'
import { Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { useToast } from '@/app/providers/ToastProvider'

export default function LoginPage() {
  const router = useRouter()
  const { loading: authInitLoading, token } = useAuth()
  const { showToast } = useToast()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [authLoading, setAuthLoading] = useState(false)

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

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Plăcuța de la intrare. Fără sticlă, fără pete de culoare care se
            mișcă: un semn prins pe perete, cu numele clădirii pe el. */}
        <div className="relative rounded-[var(--radius-plate)] border border-rule bg-plate p-8 sm:p-10">
          <span
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-[var(--sg-rail)] rounded-t-[var(--radius-plate)]"
            style={{ background: 'var(--sg-accent)' }}
          />
          <div className="mb-8">
            <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-[var(--radius-plate)] bg-[var(--sg-accent)] text-base font-bold text-white">
              B
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-ink">Bonie</h1>
            <p className="mt-2 text-sm text-ink-soft">
              Documentele, termenele și discuția fiecărui proiect de finanțare, într-un singur fir.
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-ink">Email</span>
              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="h-12 w-full rounded-[var(--radius-plate)] border border-rule bg-plate px-3 text-sm text-ink placeholder:text-ink-faint transition-colors duration-[120ms] focus:border-[var(--sg-accent)]"
                placeholder="nume@companie.ro"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-ink">Parolă</span>
              <span className="relative block">
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="h-12 w-full rounded-[var(--radius-plate)] border border-rule bg-plate px-3 pr-14 text-sm text-ink placeholder:text-ink-faint transition-colors duration-[120ms] focus:border-[var(--sg-accent)]"
                  placeholder="••••••••"
                />
                <IconButton
                  type="button"
                  label={showPassword ? 'Ascunde parola' : 'Arată parola'}
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-1 top-1/2 -translate-y-1/2"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </IconButton>
              </span>
            </label>

            <Button type="submit" variant="primary" disabled={authLoading} className="w-full">
              {authLoading ? 'Se conectează…' : 'Intră în cont'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
