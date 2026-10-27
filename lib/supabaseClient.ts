import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { detectSessionInUrl: false },
})

// Cheia implicită a supabase-js pentru sesiunea salvată în localStorage.
const sessionStorageKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`

/**
 * Șterge sesiunea salvată în browser. signOut({ scope: 'local' }) o lasă pe loc când
 * serverul a revocat deja sesiunea (auth-js transformă 403 session_not_found în
 * AuthSessionMissingError și iese înainte de _removeSession).
 */
export function clearStoredSession() {
  try {
    window.localStorage.removeItem(sessionStorageKey)
    window.localStorage.removeItem(`${sessionStorageKey}-code-verifier`)
    window.localStorage.removeItem(`${sessionStorageKey}-user`)
  } catch {
    // localStorage indisponibil: nu există nimic de șters.
  }
}