'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authLoading, setAuthLoading] = useState(false)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setAuthLoading(true)
    
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    
    if (error) {
      alert(error.message)
      setAuthLoading(false)
    } else {
      router.push('/')
      router.refresh()
    }
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
          
          <form onSubmit={handleLogin} className="space-y-5">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider ml-1">Email</label>
              <input 
                type="email" 
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all duration-200"
                placeholder="nume@companie.ro"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider ml-1">Parolă</label>
              <input 
                type="password" 
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all duration-200"
                placeholder="••••••••"
              />
            </div>
            
            <button 
              disabled={authLoading} 
              className="w-full py-3.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-semibold shadow-lg shadow-slate-900/20 active:scale-[0.98] transition-all duration-200 disabled:opacity-70 disabled:cursor-not-allowed mt-2"
            >
              {authLoading ? 'Se conectează...' : 'Intră în cont'}
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-slate-100 text-center">

          </div>
        </div>
      </div>
    </div>
  )
}