'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { userErrorMessage } from '@/lib/user-error'

type Profile = {
  id: string
  role: 'admin' | 'consultant' | 'client' | string
  email?: string | null
  full_name?: string | null
  telefon?: string | null
  cif?: string | null
} | null

type AuthCtx = {
  token: string | null
  userId: string | null
  user: unknown | null
  profile: Profile
  loading: boolean
  apiFetch: (input: RequestInfo, init?: RequestInit) => Promise<Response>
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()

  const [token, setToken] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [user, setUser] = useState<unknown | null>(null)
  const [profile, setProfile] = useState<Profile>(null)
  const [loading, setLoading] = useState(true)

  // apiFetch: toate requesturile către API routes cu Bearer token
  const apiFetch = useCallback(async (input: RequestInfo, init?: RequestInit) => {
      if (!token) {
        throw new Error('Missing Authorization Bearer token')
      }

      const headers = new Headers(init?.headers || {})
      headers.set('Authorization', `Bearer ${token}`)

      // Setăm JSON header doar dacă body e string (JSON.stringify(...)).
      // Dacă body e FormData (upload), NU setăm Content-Type manual.
      if (typeof init?.body === 'string' && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json')
      }

      const response = await fetch(input, { ...init, headers })

      if (!response.ok) {
        const readJson = response.json.bind(response)
        Object.defineProperty(response, 'json', {
          value: async () => {
            const body = await readJson()
            if (body && typeof body === 'object' && 'error' in body) {
              return { ...body, error: userErrorMessage(response.status, 'Nu am putut finaliza acțiunea.') }
            }
            return body
          },
        })
      }

      return response
  }, [token])

  // 1) Inițializare: citim sesiunea și ne abonăm la schimbări
  useEffect(() => {
    let mounted = true

    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!mounted) return

      const t = session?.access_token ?? null

      if (!t) {
        setToken(null)
        setUserId(null)
        setUser(null)
        setProfile(null)
        setLoading(false)
        router.replace('/login')
        return
      }

      setToken(t)
      setUserId(session?.user?.id ?? null)
      setUser(session?.user ?? null)
      setLoading(false)
    }

    init()

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return

      const t = session?.access_token ?? null
      setToken(t)
      setUserId(session?.user?.id ?? null)
      setUser(session?.user ?? null)

      if (!t) {
        setProfile(null)
        router.replace('/login')
      }
    })

    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [router])

  // 2) Încărcăm profilul (rolul etc.) după ce avem token
  useEffect(() => {
    let cancelled = false

    const loadProfile = async () => {
      if (!token) {
        setProfile(null)
        return
      }

      try {
        const res = await apiFetch('/api/me', { method: 'GET' })
        const json = await res.json().catch(() => null)

        if (cancelled) return

        if (!res.ok) {
          // Token invalid / expiră / alte erori -> logout "soft"
          console.warn('Failed to load /api/me:', json)
          setProfile(null)
          return
        }

        // Acceptăm fie { profile }, fie { user, profile }
        setProfile(json?.profile ?? null)
      } catch {
        if (!cancelled) setProfile(null)
      }
    }

    loadProfile()

    return () => {
      cancelled = true
    }
  }, [token, apiFetch])

  const signOut = useCallback(async () => {
    // Înregistrăm audit log pentru logout ÎNAINTE de a șterge sesiunea
    if (token) {
      try {
        await fetch('/api/auth/audit', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ action: 'logout' })
        })
      } catch (auditError) {
        // Nu blocăm logout-ul dacă audit-ul eșuează
        console.warn('Audit logging failed:', auditError)
      }
    }

    await supabase.auth.signOut()
    setToken(null)
    setUserId(null)
    setUser(null)
    setProfile(null)
    router.replace('/login')
  }, [router, token])

  const value = useMemo(
    () => ({ token, userId, user, profile, loading, apiFetch, signOut }),
    [token, userId, user, profile, loading, apiFetch, signOut]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth must be used within AuthProvider')
  return v
}
