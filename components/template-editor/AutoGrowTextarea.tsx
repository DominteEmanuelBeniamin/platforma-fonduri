'use client'

import { useLayoutEffect, useRef } from 'react'

/**
 * Un `textarea` care crește cu textul, de la 2 la 8 rânduri, apoi derulează
 * (S-25): o descriere scrisă într-un câmp de un rând nu se vedea.
 *
 * `field-sizing: content` face asta în CSS; unde nu e suportat, înălțimea se
 * potrivește după `scrollHeight` la fiecare schimbare.
 */
export function AutoGrowTextarea({
  value,
  onChange,
  placeholder,
  id,
  className = '',
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  id?: string
  className?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || (typeof CSS !== 'undefined' && CSS.supports?.('field-sizing', 'content'))) return
    el.style.height = 'auto'
    // `max-h` din clase oprește creșterea la 8 rânduri.
    el.style.height = `${el.scrollHeight + 2}px`
  }, [value])

  return (
    <textarea
      ref={ref}
      id={id}
      value={value}
      onChange={event => onChange(event.target.value)}
      placeholder={placeholder}
      rows={2}
      className={`block min-h-[calc(2lh+1rem)] max-h-[calc(8lh+1rem)] w-full resize-none overflow-y-auto rounded-[var(--radius-plate)] border border-rule bg-plate px-3 py-2 text-sm leading-5 text-ink placeholder:text-ink-faint transition-colors duration-[120ms] [field-sizing:content] focus:border-[var(--sg-accent)] ${className}`}
    />
  )
}
