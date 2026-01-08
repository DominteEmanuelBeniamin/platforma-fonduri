/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

interface Profile {
  id: string
  email: string
  full_name: string
  role: string
}

export default function Home() {
  // --- 1. STATE-URILE (Variabilele) ---
  const [session, setSession] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  // --- 2. DEFINIM FUNCȚIA FETCH (Acum e sus, ca să fie văzută) ---
  const fetchProfiles = async () => {
    setErrorMsg(null)
    const { data, error } = await supabase
      .from('profiles')
      .select('*')

    if (error) {
      console.error('Eroare la fetch:', error)
      setErrorMsg(error.message)
    } else {
      setProfiles((data as any) || [])
    }
  }

  // --- 3. EFECTUL (Rulează la pornire) ---
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) fetchProfiles() // Acum funcția există deja!
      setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session) fetchProfiles()
      else setProfiles([])
    })

    return () => subscription.unsubscribe()
  }, [])

  // --- 4. ALTE FUNCȚII (Login/Logout) ---
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setErrorMsg(null)

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setErrorMsg(error.message)
      setLoading(false)
    }
    // Dacă e ok, useEffect-ul de mai sus se ocupă de restul
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    setProfiles([])
  }

  if (loading && !session) return <div style={{padding: 50}}>Se încarcă...</div>

  // --- 5. HTML-UL PAGINII ---
  
  // A. Dacă NU ești logat
  if (!session) {
    return (
      <div style={{ maxWidth: '400px', margin: '50px auto', fontFamily: 'sans-serif', padding: '20px', border: '1px solid #ccc', borderRadius: '8px' }}>
        <h1 style={{ textAlign: 'center' }}>🔐 Logare Platformă</h1>
        
        {errorMsg && <div style={{ color: 'red', marginBottom: '10px', textAlign: 'center' }}>{errorMsg}</div>}

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <input
            type="email"
            placeholder="Email Admin"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ padding: '10px', fontSize: '16px' }}
            required
          />
          <input
            type="password"
            placeholder="Parola"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ padding: '10px', fontSize: '16px' }}
            required
          />
          <button 
            type="submit" 
            style={{ padding: '10px', backgroundColor: 'black', color: 'white', border: 'none', cursor: 'pointer', fontSize: '16px' }}
            disabled={loading}
          >
            {loading ? 'Se verifică...' : 'Intră în cont'}
          </button>
        </form>
      </div>
    )
  }

  // B. Dacă ești logat
  return (
    <div style={{ padding: '50px', fontFamily: 'sans-serif', maxWidth: '800px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
        <h1>👋 Salut, {session.user.email}</h1>
        <button onClick={handleLogout} style={{ padding: '8px 16px', cursor: 'pointer' }}>Ieșire cont</button>
      </div>

      {errorMsg && <p style={{ color: 'red', fontWeight: 'bold' }}>Eroare Supabase: {errorMsg}</p>}

      <h2>Lista Utilizatori (Din baza de date):</h2>
      
      {profiles.length === 0 ? (
        <p>Nu există profiluri sau nu ai dreptul să le vezi.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {profiles.map((profile) => (
            <li key={profile.id} style={{ padding: '15px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between' }}>
              <span>📧 {profile.email}</span>
              <span style={{ fontWeight: 'bold', color: profile.role === 'admin' ? 'red' : 'blue' }}>
                {profile.role ? profile.role.toUpperCase() : 'FARA ROL'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}