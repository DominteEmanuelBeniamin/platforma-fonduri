'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal } from 'lucide-react'

type MenuPosition = {
  left: number
  top: number
  maxHeight: number
  maxWidth: number
}

function getMenuBounds(anchor: HTMLElement) {
  const visualViewport = window.visualViewport
  const viewportLeft = visualViewport?.offsetLeft ?? 0
  const viewportTop = visualViewport?.offsetTop ?? 0
  const viewport = {
    left: viewportLeft + 8,
    top: viewportTop + 8,
    right: viewportLeft + (visualViewport?.width ?? window.innerWidth) - 8,
    bottom: viewportTop + (visualViewport?.height ?? window.innerHeight) - 8,
  }

  for (let parent = anchor.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    const style = window.getComputedStyle(parent)
    const clipsMenu = [style.overflowX, style.overflowY].some(value =>
      value === 'auto' || value === 'scroll' || value === 'hidden' || value === 'clip'
    )
    if (!clipsMenu) continue

    const rect = parent.getBoundingClientRect()
    return {
      left: Math.max(viewport.left, rect.left + parent.clientLeft),
      top: Math.max(viewport.top, rect.top + parent.clientTop),
      right: Math.min(viewport.right, rect.left + parent.clientLeft + parent.clientWidth),
      bottom: Math.min(viewport.bottom, rect.top + parent.clientTop + parent.clientHeight),
    }
  }

  return viewport
}

/** Menu de chat randat în afara listelor cu overflow și ancorat la butonul „⋯”. */
export default function ChatActionMenu({
  open,
  onOpenChange,
  label,
  className = '',
  buttonClassName = '',
  iconClassName = 'h-[18px] w-[18px]',
  align = 'end',
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  label: string
  className?: string
  buttonClassName?: string
  iconClassName?: string
  align?: 'start' | 'end'
  children: ReactNode
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<MenuPosition | null>(null)
  const positioned = position !== null

  const place = useCallback(() => {
    const anchor = buttonRef.current
    const menu = menuRef.current
    if (!anchor || !menu) return

    const anchorRect = anchor.getBoundingClientRect()
    const bounds = getMenuBounds(anchor)
    if (anchorRect.bottom <= bounds.top || anchorRect.top >= bounds.bottom) {
      onOpenChange(false)
      return
    }

    const edge = 4
    const maxWidth = Math.max(1, bounds.right - bounds.left - edge * 2)
    const width = Math.min(menu.getBoundingClientRect().width, maxWidth)
    const minLeft = bounds.left + edge
    const maxLeft = Math.max(minLeft, bounds.right - width - edge)
    const requestedLeft = align === 'start' ? anchorRect.left : anchorRect.right - width
    const left = Math.min(maxLeft, Math.max(minLeft, requestedLeft))

    const menuHeight = menu.scrollHeight + menu.offsetHeight - menu.clientHeight
    const availableHeight = Math.max(1, bounds.bottom - bounds.top - edge * 2)
    const spaceAbove = Math.max(0, anchorRect.top - bounds.top - edge)
    const spaceBelow = Math.max(0, bounds.bottom - anchorRect.bottom - edge)
    const fitsBelow = spaceBelow >= menuHeight
    const fitsAbove = spaceAbove >= menuHeight
    const maxHeight = availableHeight
    const preferredTop = spaceBelow >= spaceAbove
      ? anchorRect.bottom + edge
      : anchorRect.top - edge - menuHeight
    const top = fitsBelow
      ? anchorRect.bottom + edge
      : fitsAbove
        ? anchorRect.top - edge - menuHeight
        : menuHeight <= availableHeight
          ? Math.min(bounds.bottom - edge - menuHeight, Math.max(bounds.top + edge, preferredTop))
          : bounds.top + edge

    setPosition({ left, top, maxHeight, maxWidth })
  }, [align, onOpenChange])

  useLayoutEffect(() => {
    if (open) place()
  }, [open, place])

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (
        target instanceof Node &&
        !rootRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        onOpenChange(false)
      }
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onOpenChange(false)
        buttonRef.current?.focus({ preventScroll: true })
        return
      }
      if (event.key === 'Tab') {
        onOpenChange(false)
        buttonRef.current?.focus({ preventScroll: true })
        return
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return

      const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
      if (!items.length) return
      event.preventDefault()
      const current = items.indexOf(document.activeElement as HTMLButtonElement)
      const next = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : event.key === 'ArrowDown'
            ? (current + 1) % items.length
            : (current - 1 + items.length) % items.length
      items[next].focus({ preventScroll: true })
    }

    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    window.visualViewport?.addEventListener('scroll', place)
    window.visualViewport?.addEventListener('resize', place)
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)

    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place)
    if (buttonRef.current) observer?.observe(buttonRef.current)
    if (menuRef.current) observer?.observe(menuRef.current)

    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
      window.visualViewport?.removeEventListener('scroll', place)
      window.visualViewport?.removeEventListener('resize', place)
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      observer?.disconnect()
    }
  }, [open, onOpenChange, place])

  useEffect(() => {
    if (!open || !positioned) return
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true })
  }, [open, positioned])

  return (
    <div
      ref={rootRef}
      className={className}
      onClick={event => event.stopPropagation()}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        className={buttonClassName}
      >
        <MoreHorizontal className={iconClassName} />
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          role="menu"
          onClick={event => event.stopPropagation()}
          style={{
            position: 'fixed',
            left: position?.left ?? 0,
            top: position?.top ?? 0,
            maxHeight: position?.maxHeight,
            maxWidth: position?.maxWidth,
            minWidth: position ? Math.min(140, position.maxWidth) : 140,
            visibility: position ? 'visible' : 'hidden',
            overflowY: 'auto',
          }}
          className="z-[1000000] rounded-xl border border-rule bg-white p-1.5 shadow-xl"
        >
          {children}
        </div>,
        document.body,
      )}
    </div>
  )
}
