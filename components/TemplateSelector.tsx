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
  status: 'draft' | 'published'
  is_active: boolean
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
          setTemplates((data.templates || []).filter((t: any) => t.status === 'published' && t.is_active).map((t: any) => ({
            id: t.id,
            name: t.name,
            description: t.description,
            total_phases: t.phases?.length || 0,
            total_activities: t.phases?.reduce((sum: number, p: any) => sum + (p.activities?.length || 0), 0) || 0,
            total_documents: t.phases?.reduce((sum: number, p: any) => 
              sum + p.activities?.reduce((aSum: number, a: any) => aSum + (a.document_requirements?.length || 0), 0) || 0, 0) || 0,
            status: t.status,
            is_active: t.is_active,
          })))
        }
      } catch (error) {
        console.error('Eroare:', error)
      } finally {
        setLoading(false)
      }
    }
    fetchTemplates()
  }, [apiFetch])

  const selectedTemplate = templates.find(t => t.id === selectedTemplateId)

  if (loading) return <div className="h-12 bg-paper-sunk rounded-lg animate-pulse"></div>

  return (
    <div className="relative">
      <label className="block text-sm font-medium text-ink mb-2">
        Template proiect <span className="text-ink-faint font-normal">(opțional)</span>
      </label>

      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-all text-left ${
          isOpen ? 'border-[var(--sg-accent)] ring-2 ring-[var(--sg-accent)]' : 'border-rule hover:border-rule-strong'
        }`}
      >
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${selectedTemplate ? 'bg-[var(--sg-accent-soft)]' : 'bg-paper-sunk'}`}>
            <Layers className={`w-5 h-5 ${selectedTemplate ? 'text-[var(--sg-accent)]' : 'text-ink-faint'}`} />
          </div>
          <div>
            {selectedTemplate ? (
              <>
                <p className="font-medium text-ink">{selectedTemplate.name}</p>
                <p className="text-xs text-ink-soft">{selectedTemplate.total_phases} faze • {selectedTemplate.total_activities} activități</p>
              </>
            ) : (
              <>
                <p className="font-medium text-ink-soft">Fără template</p>
                <p className="text-xs text-ink-faint">Proiect gol, adaugi fazele manual</p>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {selectedTemplate && (
            <button type="button" onClick={(e) => { e.stopPropagation(); onSelect(null) }} className="p-1 text-ink-faint hover:text-ink-soft hover:bg-paper-sunk rounded">
              <X className="w-4 h-4" />
            </button>
          )}
          <ChevronDown className={`w-5 h-5 text-ink-faint transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          <div className="absolute z-20 w-full mt-2 bg-white rounded-xl border border-rule shadow-lg max-h-80 overflow-y-auto">
            <button
              type="button"
              onClick={() => { onSelect(null); setIsOpen(false) }}
              className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-paper-sunk text-left ${!selectedTemplateId ? 'bg-paper-sunk' : ''}`}
            >
              <div className="w-8 h-8 rounded-lg bg-paper-sunk flex items-center justify-center">
                <Layers className="w-4 h-4 text-ink-faint" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-ink">Fără template</p>
                <p className="text-xs text-ink-faint">Creează proiectul gol</p>
              </div>
              {!selectedTemplateId && <Check className="w-5 h-5 text-[var(--sg-accent)]" />}
            </button>

            <div className="border-t border-rule" />

            {templates.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-ink-soft">Nu există template-uri</div>
            ) : (
              templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => { onSelect(template.id); setIsOpen(false) }}
                  className={`w-full flex items-start gap-3 px-4 py-3 hover:bg-paper-sunk text-left ${selectedTemplateId === template.id ? 'bg-[var(--sg-accent-soft)]' : ''}`}
                >
                  <div className="w-8 h-8 rounded-lg bg-[var(--sg-accent-soft)] flex items-center justify-center flex-shrink-0">
                    <Layers className="w-4 h-4 text-[var(--sg-accent)]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-ink">{template.name}</p>
                    {template.description && <p className="text-xs text-ink-soft truncate">{template.description}</p>}
                    <div className="flex items-center gap-3 mt-1 text-xs text-ink-faint">
                      <span className="flex items-center gap-1"><FolderOpen className="w-3 h-3" />{template.total_phases} faze</span>
                      <span className="flex items-center gap-1"><Activity className="w-3 h-3" />{template.total_activities} activități</span>
                      <span className="flex items-center gap-1"><FileText className="w-3 h-3" />{template.total_documents} docs</span>
                    </div>
                  </div>
                  {selectedTemplateId === template.id && <Check className="w-5 h-5 text-[var(--sg-accent)] flex-shrink-0" />}
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}
