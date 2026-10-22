'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePathname } from 'next/navigation'

/**
 * Tooltip-urile aplicației — un singur strat, pentru toate butoanele.
 *
 * În loc să înfășurăm fiecare din cele câteva sute de butoane într-o
 * componentă, stratul ascultă o dată, pe document, și găsește singur ce are
 * de explicat elementul de sub cursor sau din focus:
 *   1. `data-tooltip="…"` — explicația scrisă anume pentru tooltip;
 *   2. `title="…"` — vechiul tooltip al browserului, acum desenat de noi;
 *   3. `aria-label` — numele unui buton doar cu iconiță (lupă, ⋯, coș),
 *      când textul vizibil nu spune deja același lucru.
 * `data-tooltip=""` sau `data-tooltip-off` pe un element (sau pe un părinte)
 * îl opresc.
 *
 * Apare după o secundă, fără animație (D6). Imediat apare doar când treci de
 * la un buton mic la altul, cu un tooltip abia închis: o plimbare peste
 * rânduri (fazele din panou, pastilele de stare) nu mai aprinde câte un
 * tooltip pe fiecare. Apare și la focus de la tastatură; Escape îl închide;
 * cursorul poate trece pe el fără să dispară (WCAG 1.4.13). Pe touch nu
 * apare — acolo nu există hover, deci nimic esențial nu stă doar în tooltip.
 *
 * `data-tooltip-side="right"` (pe element sau pe un părinte) îl pune în
 * dreapta, centrat vertical: în panoul fazelor, deasupra sau dedesubt ar
 * acoperi faza vecină. Dacă nu încape, revine deasupra sau dedesubt.
 */

const SHOW_DELAY = 1000
/** Cât timp după ce s-a ascuns un tooltip următorul apare fără întârziere. */
const SKIP_DELAY = 400
/** Răgazul în care cursorul poate trece de pe buton pe tooltip. */
const HIDE_GRACE = 120
const TOOLTIP_ID = 'sg-tooltip'
const CANDIDATES = '[data-tooltip],[title],button,a[href],[role="button"],[role="switch"],[role="tab"]'
/** Butoanele mici, între care tooltip-ul trece fără întârziere. */
const SMALL_CONTROL = 'button,a[href],[role="button"],[role="switch"],[role="tab"]'
const isSmallControl = (el: Element) => el.matches(SMALL_CONTROL)

function normalize(text: string) {
  return text.toLowerCase().replace(/[.:…,]/g, '').replace(/\s+/g, ' ').trim()
}

/** Ce scrie în tooltip pentru un element, sau `null` dacă n-are nimic de adăugat. */
function tooltipText(el: HTMLElement): string | null {
  if (el.closest('[data-tooltip-off]')) return null
  const explicit = el.getAttribute('data-tooltip')
  if (explicit !== null) return explicit.trim() || null
  const title = el.getAttribute('title') ?? el.getAttribute('data-tooltip-title')
  if (title?.trim()) return title.trim()
  const label = el.getAttribute('aria-label')?.trim()
  if (!label) return null
  const visible = (el.innerText || '').replace(/\s+/g, ' ').trim()
  // Un buton care scrie deja pe el ce face n-are nevoie să repete în tooltip.
  if (visible && normalize(visible) === normalize(label)) return null
  return label
}

type Tip = { text: string; rect: DOMRect; side: 'right' | null }

const sideOf = (el: HTMLElement): Tip['side'] =>
  el.closest('[data-tooltip-side]')?.getAttribute('data-tooltip-side') === 'right' ? 'right' : null

export default function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const hideRef = useRef<() => void>(() => {})
  const pathname = usePathname()

  useEffect(() => {
    let showTimer: ReturnType<typeof setTimeout> | null = null
    let hideTimer: ReturnType<typeof setTimeout> | null = null
    /** Elementul al cărui tooltip se vede sau urmează să se vadă. */
    let target: HTMLElement | null = null
    let visible = false
    /** Textul tooltip-ului vizibil, ca să-l poată muta la derulare. */
    let shownText = ''
    let lastHiddenAt = 0
    /** Ultimul tooltip văzut era al unui buton mic, nu al unui rând. */
    let lastWasSmall = false
    /** După un clic, butonul apăsat nu-și mai arată tooltip-ul până nu-l părăsește cursorul. */
    let suppressed: HTMLElement | null = null
    /** Elementul căruia i-am scos temporar `title`, ca browserul să nu-și deseneze propriul tooltip. */
    let stashed: HTMLElement | null = null
    let describedBy: HTMLElement | null = null
    /**
     * Elementul al cărui tooltip se vede, marcat `data-tooltip-state="open"` —
     * ca `data-state` la Radix: stil și teste pot ști al cui e tooltip-ul.
     */
    let shownOn: HTMLElement | null = null
    const unmark = () => {
      shownOn?.removeAttribute('data-tooltip-state')
      shownOn = null
    }

    const clearTimers = () => {
      if (showTimer) clearTimeout(showTimer)
      if (hideTimer) clearTimeout(hideTimer)
      showTimer = hideTimer = null
    }

    const restoreTitle = () => {
      if (!stashed) return
      const title = stashed.getAttribute('data-tooltip-title')
      // Dacă React a pus între timp alt `title`, rămâne al lui.
      if (title !== null && !stashed.hasAttribute('title')) stashed.setAttribute('title', title)
      stashed.removeAttribute('data-tooltip-title')
      stashed = null
    }

    const dropDescription = () => {
      if (!describedBy) return
      const rest = (describedBy.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(id => id && id !== TOOLTIP_ID)
      if (rest.length) describedBy.setAttribute('aria-describedby', rest.join(' '))
      else describedBy.removeAttribute('aria-describedby')
      describedBy = null
    }

    const hide = () => {
      clearTimers()
      if (visible) lastHiddenAt = Date.now()
      visible = false
      target = null
      unmark()
      dropDescription()
      restoreTitle()
      setTip(null)
    }
    hideRef.current = hide

    const show = (el: HTMLElement, text: string) => {
      if (!el.isConnected) return
      visible = true
      unmark()
      el.setAttribute('data-tooltip-state', 'open')
      shownOn = el
      shownText = text
      lastWasSmall = isSmallControl(el)
      // Tooltip-ul descrie elementul cât se vede, ca la Radix — dacă spune
      // altceva decât numele lui.
      if (normalize(text) !== normalize(el.getAttribute('aria-label') ?? '')) {
        const ids = (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)
        if (!ids.includes(TOOLTIP_ID)) el.setAttribute('aria-describedby', [...ids, TOOLTIP_ID].join(' '))
        describedBy = el
      }
      setTip({ text, rect: el.getBoundingClientRect(), side: sideOf(el) })
    }

    const schedule = (el: HTMLElement, via: 'pointer' | 'focus') => {
      const text = tooltipText(el)
      if (!text) { hide(); return }
      clearTimers()
      if (target !== el) {
        unmark()
        dropDescription()
        restoreTitle()
        if (visible) { visible = false; lastHiddenAt = Date.now(); setTip(null) }
      }
      target = el
      if (via === 'pointer' && el.hasAttribute('title')) {
        el.setAttribute('data-tooltip-title', el.getAttribute('title')!)
        el.removeAttribute('title')
        stashed = el
      }
      const immediate = via === 'focus'
        || (Date.now() - lastHiddenAt < SKIP_DELAY && lastWasSmall && isSmallControl(el))
      showTimer = setTimeout(() => show(el, text), immediate ? 0 : SHOW_DELAY)
    }

    const candidateOf = (node: EventTarget | null) =>
      node instanceof Element ? (node.closest(CANDIDATES) as HTMLElement | null) : null

    const onPointerOver = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return
      const node = event.target as Node
      if (tipRef.current?.contains(node)) {
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null }
        return
      }
      const el = candidateOf(event.target)
      if (el !== suppressed) suppressed = null
      if (el && el === suppressed) return
      if (el && el === target) {
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null }
        return
      }
      if (el && tooltipText(el)) { schedule(el, 'pointer'); return }
      if (target) {
        if (showTimer) { clearTimeout(showTimer); showTimer = null }
        if (hideTimer) clearTimeout(hideTimer)
        hideTimer = setTimeout(hide, HIDE_GRACE)
      }
    }

    const onPointerLeaveDocument = (event: PointerEvent) => {
      if (!event.relatedTarget) hide()
    }

    const onPointerDown = (event: PointerEvent) => {
      suppressed = candidateOf(event.target)
      hide()
    }

    const onFocusIn = (event: FocusEvent) => {
      const el = candidateOf(event.target)
      if (!el) return
      let keyboard = false
      try { keyboard = (event.target as Element).matches(':focus-visible') } catch { /* selector nesuportat */ }
      if (keyboard) schedule(el, 'focus')
    }

    const onFocusOut = () => { if (target) hide() }

    // La derulare tooltip-ul merge cu elementul cât timp mausul sau focusul e
    // încă pe el, ca la Radix; altfel dispare. Ascuns la orice derulare, s-ar
    // fi stins și când pagina se mișcă singură sub un cursor nemișcat, iar
    // fără o nouă intrare pe element nu mai revenea.
    const onScroll = () => {
      if (!target) return
      const still = target.isConnected && (target.matches(':hover') || target.contains(document.activeElement))
      if (!still) { hide(); return }
      if (visible) setTip({ text: shownText, rect: target.getBoundingClientRect(), side: sideOf(target) })
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (!visible && !showTimer) return
      if (event.key === 'Escape') {
        // Escape închide întâi un tooltip vizibil, nu și dialogul de sub el.
        // Unul doar programat se anulează, iar tasta merge mai departe: altfel
        // primul Escape după un clic nu închidea sertarul sau dialogul.
        if (!visible) { hide(); return }
        event.stopPropagation()
        event.preventDefault()
        hide()
        return
      }
      if (event.key === 'Enter' || event.key === ' ') hide()
    }

    document.addEventListener('pointerover', onPointerOver, true)
    document.addEventListener('pointerout', onPointerLeaveDocument, true)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('focusin', onFocusIn, true)
    document.addEventListener('focusout', onFocusOut, true)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', hide)
    window.addEventListener('blur', hide)
    return () => {
      hide()
      document.removeEventListener('pointerover', onPointerOver, true)
      document.removeEventListener('pointerout', onPointerLeaveDocument, true)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('focusin', onFocusIn, true)
      document.removeEventListener('focusout', onFocusOut, true)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', hide)
      window.removeEventListener('blur', hide)
    }
  }, [])

  // Altă pagină, alt context: nimic nu rămâne agățat.
  useEffect(() => { hideRef.current() }, [pathname])

  // Deasupra elementului; dedesubt, dacă sus nu încape. Cu `side="right"`, în
  // dreapta, dacă are loc. Mereu în ecran.
  useLayoutEffect(() => {
    const el = tipRef.current
    if (!tip || !el) return
    const { width, height } = el.getBoundingClientRect()
    const gap = 6
    if (tip.side === 'right' && tip.rect.right + gap + width <= window.innerWidth - 8) {
      const middle = tip.rect.top + tip.rect.height / 2 - height / 2
      el.style.top = `${Math.max(8, Math.min(middle, window.innerHeight - height - 8))}px`
      el.style.left = `${tip.rect.right + gap}px`
      el.style.visibility = 'visible'
      return
    }
    let top = tip.rect.top - height - gap
    if (top < 8) top = tip.rect.bottom + gap
    const left = Math.max(8, Math.min(tip.rect.left + tip.rect.width / 2 - width / 2, window.innerWidth - width - 8))
    el.style.top = `${top}px`
    el.style.left = `${left}px`
    el.style.visibility = 'visible'
  }, [tip])

  if (!tip) return null
  return createPortal(
    <div
      ref={tipRef}
      id={TOOLTIP_ID}
      role="tooltip"
      style={{ position: 'fixed', top: 0, left: 0, visibility: 'hidden', pointerEvents: 'auto' }}
      className="sg-tooltip z-[1000001] max-w-[18rem] rounded-[var(--radius-plate)] bg-ink px-2 py-1.5 text-xs font-medium leading-snug text-white shadow-[var(--sg-lift)]"
    >
      {tip.text}
    </div>,
    document.body,
  )
}
