/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { useState, useEffect } from 'react'
import { Layers, ChevronDown, Check, FolderOpen, Activity, FileText, X } from 'lucide-react'
import { useAuth } from '@/app/providers/AuthProvider'

interface TemplateOverview {
  id: string
  name: string
  description: string | null
  total_phases: number
  total_activities: number
  total_documents: number
}

interface TemplateSelectorProps {
  selectedTemplateId: string | null
  onSelect: (templateId: string | null) => void
}

export default function TemplateSelector({ selectedTemplateId, onSelect }: TemplateSelectorProps) {
  const { apiFetch } = useAuth()
  const [templates, setTemplates] = useState<TemplateOverview[]>([])
  const [loading, setLoading] = useState(true)
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    const fetchTemplates = async () => {
      try {
        const res = await apiFetch('/api/admin/templates')
        if (res.ok) {
          const data = await res.json()
          setTemplates((data.templates || []).map((t: any) => ({
            id: t.id,
            name: t.name,
            description: t.description,
            total_phases: t.phases?.length || 0,
            total_activities: t.phases?.reduce((sum: number, p: any) => sum + (p.activities?.length || 0), 0) || 0,
            total_documents: t.phases?.reduce((sum: number, p: any) => 
              sum + p.activities?.reduce((aSum: number, a: any) => aSum + (a.document_requirements?.length || 0), 0) || 0, 0) || 0
          })))
        }
      } catch (error) {
        console.error('Eroare:', error)
      } finally {
        setLoading(false)
      }
    }
    fetchTemplates()
  }, [])

  const selectedTemplate = templates.find(t => t.id === selectedTemplateId)

  if (loading) return <div className="h-12 bg-slate-100 rounded-lg animate-pulse"></div>

  return (
    <div className="relative">
      <label className="block text-sm font-medium text-slate-700 mb-2">
        Template proiect <span className="text-slate-400 font-normal">(opțional)</span>
      </label>

      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-all text-left ${
          isOpen ? 'border-indigo-400 ring-2 ring-indigo-400/10' : 'border-slate-200 hover:border-slate-300'
        }`}
      >
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${selectedTemplate ? 'bg-indigo-100' : 'bg-slate-100'}`}>
            <Layers className={`w-5 h-5 ${selectedTemplate ? 'text-indigo-600' : 'text-slate-400'}`} />
          </div>
          <div>
            {selectedTemplate ? (
              <>
                <p className="font-medium text-slate-900">{selectedTemplate.name}</p>
                <p className="text-xs text-slate-500">{selectedTemplate.total_phases} faze • {selectedTemplate.total_activities} activități</p>
              </>
            ) : (
              <>
                <p className="font-medium text-slate-600">Fără template</p>
                <p className="text-xs text-slate-400">Proiect gol, adaugi fazele manual</p>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {selectedTemplate && (
            <button type="button" onClick={(e) => { e.stopPropagation(); onSelect(null) }} className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded">
              <X className="w-4 h-4" />
            </button>
          )}
          <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          <div className="absolute z-20 w-full mt-2 bg-white rounded-xl border border-slate-200 shadow-lg max-h-80 overflow-y-auto">
            <button
              type="button"
              onClick={() => { onSelect(null); setIsOpen(false) }}
              className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 text-left ${!selectedTemplateId ? 'bg-slate-50' : ''}`}
            >
              <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">
                <Layers className="w-4 h-4 text-slate-400" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-slate-700">Fără template</p>
                <p className="text-xs text-slate-400">Creează proiectul gol</p>
              </div>
              {!selectedTemplateId && <Check className="w-5 h-5 text-indigo-600" />}
            </button>

            <div className="border-t border-slate-100" />

            {templates.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-slate-500">Nu există template-uri</div>
            ) : (
              templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => { onSelect(template.id); setIsOpen(false) }}
                  className={`w-full flex items-start gap-3 px-4 py-3 hover:bg-slate-50 text-left ${selectedTemplateId === template.id ? 'bg-indigo-50' : ''}`}
                >
                  <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center flex-shrink-0">
                    <Layers className="w-4 h-4 text-indigo-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-900">{template.name}</p>
                    {template.description && <p className="text-xs text-slate-500 truncate">{template.description}</p>}
                    <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
                      <span className="flex items-center gap-1"><FolderOpen className="w-3 h-3" />{template.total_phases} faze</span>
                      <span className="flex items-center gap-1"><Activity className="w-3 h-3" />{template.total_activities} activități</span>
                      <span className="flex items-center gap-1"><FileText className="w-3 h-3" />{template.total_documents} docs</span>
                    </div>
                  </div>
                  {selectedTemplateId === template.id && <Check className="w-5 h-5 text-indigo-600 flex-shrink-0" />}
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}