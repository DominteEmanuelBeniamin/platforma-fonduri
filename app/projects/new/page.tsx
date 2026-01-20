'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useRouter } from 'next/navigation'

interface ClientProfile {
  id: string
  full_name?: string | null
  email?: string | null
  cui_firma?: string | null
  role?: string | null
}

export default function NewProjectPage() {
  const router = useRouter()
  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      
      if (!session) {
        // Dacă nu e logat, îl trimitem la Login
        router.push('/login')
      } 
    }
    
    checkAuth()
  }, [router])

  const [clients, setClients] = useState<ClientProfile[]>([])
  const [title, setTitle] = useState('')
  const [selectedClientId, setSelectedClientId] = useState('')
  const [loading, setLoading] = useState(false)

  // Luăm doar userii care sunt CLIENȚI pentru dropdown
  useEffect(() => {
    const fetchClients = async () => {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('role', 'client') // Filtrăm doar clienții
      
      setClients(data || [])
    }
    fetchClients()
  }, [])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
  
    try {
      // 1) luăm session ca să trimitem token-ul către API
      const {
        data: { session }
      } = await supabase.auth.getSession()
  
      if (!session) {
        alert('Nu ești logat.')
        router.push('/login')
        return
      }
  
      // 2) apelăm endpoint-ul server-side
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          title,                 // string
          client_id: selectedClientId // string
        })
      })
  
      const result = await response.json()
  
      if (!response.ok) {
        alert('Eroare: ' + (result?.error || 'Unknown error'))
        return
      }
  
      alert('Proiect creat cu succes! 🎉')
      router.push('/') // Dashboard
    } catch (err: any) {
      alert('Eroare: ' + (err?.message || 'Unknown error'))
    } finally {
      setLoading(false)
    }
  }
  

  return (
    <div style={{ maxWidth: '500px', margin: '0 auto', border: '1px solid #ccc', padding: '30px', borderRadius: '10px' }}>
      <h2>📂 Deschide Dosar Nou</h2>
      
      <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
        
        {/* Titlu Proiect */}
        <div>
          <label>Nume Proiect / Program Finanțare</label>
          <input 
            type="text" 
            placeholder="Ex: Digitalizare IMM - Firma X"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            style={{ width: '100%', padding: '10px', marginTop: '5px' }}
          />
        </div>

        {/* Selectare Client */}
        <div>
          <label>Beneficiar (Client)</label>
          <select 
            value={selectedClientId} 
            onChange={(e) => setSelectedClientId(e.target.value)}
            required
            style={{ width: '100%', padding: '10px', marginTop: '5px' }}
          >
            <option value="">-- Alege Clientul --</option>
            {clients.map(client => (
              <option key={client.id} value={client.id}>
                {client.full_name || client.email} (CUI: {client.cui_firma || '-'})
              </option>
            ))}
          </select>
          {clients.length === 0 && <small style={{color: 'red'}}>Nu există clienți. Du-te la Admin Users și setează rolul de Client cuiva.</small>}
        </div>

        <button 
          type="submit" 
          disabled={loading}
          style={{ padding: '12px', background: 'black', color: 'white', border: 'none', cursor: 'pointer', marginTop: '10px' }}
        >
          {loading ? 'Se creează...' : 'Creează Dosar'}
        </button>
      </form>
    </div>
  )
}