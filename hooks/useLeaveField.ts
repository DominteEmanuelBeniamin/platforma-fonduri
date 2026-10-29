'use client'

import { useEffect, useRef, type RefObject } from 'react'

/**
 * Un câmp editat pe loc se încheie când omul pleacă din el: un clic oriunde în
 * afara lui sau Tab spre un element din afară. Fără asta, redenumirea rămânea
 * deschisă după un clic în altă parte, după „Restrânge toate grupurile” sau
 * după ce alegeai altă fază (S-11, feedback-ul lui Sandu).
 *
 * `onLeave` decide ce înseamnă plecarea (salvează sau renunță). Pierderea
 * focusului fără o țintă — alt tab, altă fereastră — nu contează: omul se
 * întoarce la câmp așa cum l-a lăsat.
 */
export function useLeaveField(rootRef: RefObject<HTMLElement | null>, active: boolean, onLeave: () => void) {
  const onLeaveRef = useRef(onLeave)
  useEffect(() => { onLeaveRef.current = onLeave })

  useEffect(() => {
    if (!active) return
    const root = rootRef.current
    if (!root) return
    const onPointerDown = (event: PointerEvent) => {
      if (!root.contains(event.target as Node)) onLeaveRef.current()
    }
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget as Node | null
      if (next && !root.contains(next)) onLeaveRef.current()
    }
    // Pe captură: un rând care oprește propagarea clicului nu ascunde plecarea.
    document.addEventListener('pointerdown', onPointerDown, true)
    root.addEventListener('focusout', onFocusOut)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      root.removeEventListener('focusout', onFocusOut)
    }
  }, [active, rootRef])
}
