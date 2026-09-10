/**
 * Rotocolul de încărcare. Era desenat de mână în douăzeci și unu de locuri, cu
 * trei grosimi și două palete diferite; aici e o singură definiție.
 *
 * Nu poartă el rolul de „status” — anunțul pentru cititoarele de ecran stă pe
 * containerul care știe ce anume se încarcă.
 */
type Size = 'sm' | 'md' | 'lg'

const sizes: Record<Size, string> = {
  sm: 'h-4 w-4 border-2',
  md: 'h-8 w-8 border-[3px]',
  lg: 'h-10 w-10 border-4',
}

export function Spinner({
  size = 'lg',
  /** `accent` — pe fond plin de culoare, unde inelul petrol ar dispărea. */
  on = 'paper',
  className = '',
}: {
  size?: Size
  on?: 'paper' | 'accent'
  className?: string
}) {
  const ring = on === 'accent'
    ? 'border-white/30 border-t-white'
    : 'border-rule border-t-[var(--sg-accent)]'
  return (
    <span
      aria-hidden="true"
      className={`block shrink-0 animate-spin rounded-full ${sizes[size]} ${ring} ${className}`}
    />
  )
}
