import type { ReactNode } from 'react'
import { bandVar } from '@/lib/signage'

type PlateProps = {
  children: ReactNode
  /** Banda fazei, 1–6. Se desenează ca fâșie plină pe muchia de sus. */
  band?: number
  /** Culoare de rail explicită (un semnal), care are întâietate față de bandă. */
  rail?: string
  /** Plăcuță nemontată: contur întrerupt, fără bandă. Pentru „în lucru”. */
  draft?: boolean
  /** Plăcuța e apăsabilă: primește stări de hover și de apăsare. */
  interactive?: boolean
  selected?: boolean
  className?: string
  as?: 'div' | 'li' | 'article' | 'section'
}

/**
 * Plăcuța. Unitatea de conținut a clădirii: o față albă, o muchie subțire și,
 * când poartă o fază, banda ei sus. Fără umbră și fără colț rotund de card —
 * un semn e o bucată dreaptă de material prins pe perete.
 */
export function Plate({
  children,
  band,
  rail,
  draft = false,
  interactive = false,
  selected = false,
  className = '',
  as: Tag = 'div',
}: PlateProps) {
  return (
    <Tag
      data-selected={selected || undefined}
      className={[
        'relative bg-plate rounded-[var(--radius-plate)]',
        draft
          ? 'border border-dashed border-rule-strong bg-transparent'
          : 'border border-rule',
        selected ? 'ring-2 ring-[var(--sg-accent)] ring-offset-0 border-[var(--sg-accent)]' : '',
        interactive
          ? 'transition-colors duration-[120ms] hover:border-rule-strong hover:bg-paper-sunk/60 active:bg-paper-sunk'
          : '',
        className,
      ].filter(Boolean).join(' ')}
    >
      {(rail || band) && !draft ? (
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-[var(--sg-rail)] rounded-t-[var(--radius-plate)]"
          style={{ background: rail ?? bandVar(band!) }}
        />
      ) : null}
      {children}
    </Tag>
  )
}
