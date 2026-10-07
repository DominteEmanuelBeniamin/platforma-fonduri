'use client'

import { createContext, Fragment, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import type { AuthSession } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabaseClient'
import { userErrorMessage } from '@/lib/user-error'

type Profile = {
  id: string
  role: 'admin' | 'consultant' | 'client' | string
  /** Doar pentru consultanți; seniorul are drepturi în plus (issue #104). */
  consultant_level?: 'junior' | 'senior' | null
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
  installSession: (session: { access_token: string; refresh_token: string }, expectedUserId: string) => Promise<boolean>
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthCtx | null>(null)
const PUBLIC_PATHS = new Set(['/login', '/forgot-password', '/reset-password'])

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const isPublicPath = useRef(false)
  useLayoutEffect(() => {
    isPublicPath.current = PUBLIC_PATHS.has(pathname ?? '')
  }, [pathname])


  const [token, setToken] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [user, setUser] = useState<unknown | null>(null)
  const [profile, setProfile] = useState<Profile>(null)
  const [loading, setLoading] = useState(true)
  const sessionFailureHandled = useRef(false)
  const activeTokenRef = useRef<string | null>(null)
  const identityRef = useRef<string | null>(null)
  const identityInitializedRef = useRef(false)
  const authStateRevisionRef = useRef(0)
  const [identityRevision, setIdentityRevision] = useState(0)

  const applySession = useCallback((session: AuthSession | null, initialHydration = false) => {
    const nextToken = session?.access_token ?? null
    const nextUserId = session?.user?.id ?? null
    authStateRevisionRef.current += 1
    activeTokenRef.current = nextToken

    if (identityRef.current !== nextUserId) {
      identityRef.current = nextUserId
      setProfile(null)
      void supabase.removeAllChannels().catch(() => undefined)
      if (identityInitializedRef.current) setIdentityRevision((revision) => revision + 1)
    }

    if (nextToken) sessionFailureHandled.current = false
    setToken(nextToken)
    setUserId(nextUserId)
    setUser(session?.user ?? null)
    setLoading(false)
    if (initialHydration) identityInitializedRef.current = true
  }, [])

  const installSession = useCallback(async (
    session: { access_token: string; refresh_token: string },
    expectedUserId: string,
  ): Promise<boolean> => {
    const previousToken = activeTokenRef.current
    const revisionAtStart = authStateRevisionRef.current
    activeTokenRef.current = session.access_token

    const restorePreviousToken = () => {
      if (authStateRevisionRef.current === revisionAtStart && activeTokenRef.current === session.access_token) {
        activeTokenRef.current = previousToken
      }
    }

    try {
      const { data, error } = await supabase.auth.setSession(session)
      const established = data.session
      if (error || !established || established.user.id !== expectedUserId) {
        restorePreviousToken()
        return false
      }

      const { data: current, error: sessionError } = await supabase.auth.getSession()
      const installed = current.session
      if (sessionError || installed?.user?.id !== expectedUserId || installed.access_token !== established.access_token) {
        restorePreviousToken()
        return false
      }

      return true
    } catch {
      restorePreviousToken()
      return false
    }
  }, [])
  const expireSession = useCallback((failedToken: string) => {
    if (activeTokenRef.current !== failedToken) return
    if (sessionFailureHandled.current) return
    sessionFailureHandled.current = true
    applySession(null)
    void supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
    if (!isPublicPath.current) router.replace('/login')
  }, [applySession, router])

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

    if (response.status === 401) expireSession(token)

    if (!response.ok) {
      const readJson = response.json.bind(response)
      Object.defineProperty(response, 'json', {
        value: async () => {
          const body = await readJson().catch(() => ({
            error: userErrorMessage(response.status, 'Nu am putut finaliza acțiunea.'),
          }))
          if (body && typeof body === 'object' && 'error' in body) {
            return { ...body, error: userErrorMessage(response.status, 'Nu am putut finaliza acțiunea.', body.code) }
          }
          return body
        },
      })
    }

    return response
  }, [expireSession, token])

  // Subscribe before getSession so a recovery sign-in cannot be missed during initialization.
  useEffect(() => {
    let mounted = true
    let authRevision = 0

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return
      authRevision += 1
      applySession(session, event === 'INITIAL_SESSION')
      if (!session && event !== 'INITIAL_SESSION' && !isPublicPath.current) {
        router.replace('/login')
      }
    })

    const revisionAtStart = authRevision
    const init = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!mounted || authRevision !== revisionAtStart) return
        applySession(session, true)
        if (!session && !isPublicPath.current) router.replace('/login')
      } catch {
        if (!mounted || authRevision !== revisionAtStart) return
        applySession(null, true)
        if (!isPublicPath.current) router.replace('/login')
      }
    }

    void init()

    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [applySession, router])

  useEffect(() => {
    if (!loading && !token && !PUBLIC_PATHS.has(pathname ?? '')) router.replace('/login')
  }, [loading, pathname, router, token])

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
          if (res.status !== 401) console.warn('Failed to load /api/me:', json)
          setProfile(null)
          return
        }

        // Acceptăm fie { profile }, fie { user, profile }
        setProfile(json?.profile ?? null)
      } catch {
        if (!cancelled) setProfile(null)
      }
    }

    void loadProfile()

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
    applySession(null)
    router.replace('/login')
  }, [applySession, router, token])

  const value = useMemo(
    () => ({ token, userId, user, profile, loading, apiFetch, installSession, signOut }),
    [token, userId, user, profile, loading, apiFetch, installSession, signOut]
  )

  return (
    <Ctx.Provider value={value}>
      <Fragment key={identityRevision}>{children}</Fragment>
    </Ctx.Provider>
  )
}

export function useAuth() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth must be used within AuthProvider')
  return v
}