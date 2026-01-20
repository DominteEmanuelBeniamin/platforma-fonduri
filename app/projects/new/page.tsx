'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useRouter } from 'next/navigation'
import { 
  FolderPlus, 
  Building2, 
  FileText, 
  ArrowLeft,
  AlertCircle
} from 'lucide-react'

interface ClientProfile {
  id: string
  full_name?: string | null
  email?: string | null
  cui_firma?: string | null
  role?: string | null
}

export default function NewProjectPage() {
  const router = useRouter()
  const [clients, setClients] = useState<ClientProfile[]>([])
  const [title, setTitle] = useState('')
  const [selectedClientId, setSelectedClientId] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingClients, setLoadingClients] = useState(true)

  useEffect(() => {
    const fetchClients = async () => {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('role', 'client')
      
      setClients(data || [])
      setLoadingClients(false)
    }
    fetchClients()
  }, [])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    const { data, error } = await supabase
      .from('projects')
      .insert({
        title: title,
        client_id: selectedClientId,
        status: 'contractare'
      })
      .select()

    if (error) {
      alert('Eroare: ' + error.message)
      setLoading(false)
    } else {
      // Success animation
      setLoading(false)
      router.push('/')
    }
  }

  return (
    <div className="min-h-screen bg-slate-50/50">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6 fade-in-up">
        
        {/* BREADCRUMB & BACK BUTTON */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/')}
            className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900 transition-colors group"
          >
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
            <span className="font-medium">Proiecte</span>
          </button>
          <span className="text-slate-300">/</span>
          <span className="text-sm font-medium text-slate-900">Dosar Nou</span>
        </div>

        {/* HEADER */}
        <div className="text-center space-y-3">
          <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight">
            Deschide Dosar Nou
          </h1>
          <p className="text-slate-500 text-sm sm:text-base max-w-md mx-auto">
            Completează informațiile de mai jos pentru a crea un nou proiect de finanțare
          </p>
        </div>

        {/* FORM CARD */}
        <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <form onSubmit={handleCreate} className="p-6 sm:p-8 space-y-6">
            
            {/* Nume Proiect */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <FileText className="w-4 h-4 text-slate-500" />
                Nume Proiect / Program Finanțare
              </label>
              <input 
                type="text" 
                placeholder="Ex: Digitalizare IMM - Firma X"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-all"
              />
            </div>

            {/* Selectare Client */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Building2 className="w-4 h-4 text-slate-500" />
                Beneficiar (Client)
              </label>
              
              {loadingClients ? (
                <div className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center gap-2 text-slate-400">
                  <div className="w-4 h-4 border-2 border-slate-300 border-t-violet-600 rounded-full animate-spin"></div>
                  <span className="text-sm">Se încarcă clienții...</span>
                </div>
              ) : (
                <>
                  <select 
                    value={selectedClientId} 
                    onChange={(e) => setSelectedClientId(e.target.value)}
                    required
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-all cursor-pointer"
                  >
                    <option value="">Alege beneficiarul</option>
                    {clients.map(client => (
                      <option key={client.id} value={client.id}>
                        {client.full_name || client.email} {client.cui_firma ? `(CUI: ${client.cui_firma})` : ''}
                      </option>
                    ))}
                  </select>
                  
                  {clients.length === 0 && (
                    <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                      <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-amber-900">Nu există clienți disponibili</p>
                        <p className="text-xs text-amber-700 mt-1">
                          Du-te la Admin Users și setează rolul de Client cuiva.
                        </p>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col-reverse sm:flex-row gap-3 pt-4">
              <button 
                type="button"
                onClick={() => router.push('/')}
                className="flex-1 px-5 py-3 bg-white border border-slate-200 text-slate-700 rounded-lg text-sm font-semibold hover:bg-slate-50 transition-colors"
              >
                Anulează
              </button>
              <button 
                type="submit" 
                disabled={loading || clients.length === 0}
                className="flex-1 px-5 py-3 bg-white border border-purple-300 text-purple-700 rounded-lg text-sm font-semibold hover:bg-purple-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    Se creează...
                  </>
                ) : (
                  <>
                    <FolderPlus className="w-4 h-4" />
                    Creează Dosar
                  </>
                )}
              </button>
            </div>
          </form>
        </div>

        {/* Helper Text */}
        <p className="text-center text-xs text-slate-400">
          După creare, vei putea adăuga membrii în echipă și documenta progresul
        </p>
      </div>
    </div>
  )
}