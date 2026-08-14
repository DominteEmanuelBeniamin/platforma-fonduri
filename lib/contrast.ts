// Cât de lizibil e un text peste o culoare de fond. Pur, fără nimic din React:
// aici stă doar aritmetica, ca să poată fi verificată cu `node --test`.

export const DARK_INK = '#1F2937'
export const LIGHT_INK = '#FFFFFF'

/**
 * Pragul de la care cerneala închisă bate albul, pentru perechea de mai sus.
 * Cele două contraste sunt egale acolo unde (L+0.05)² = 1.05 × (L_închis+0.05);
 * cu L_închis = 0.0216 iese ≈ 0.224.
 *
 * Cifra contează: pusă la 0.45, cum era întâi, ramura închisă nu s-ar fi atins
 * niciodată — cea mai deschisă culoare din paleta de avatare, chihlimbarul, are
 * L = 0.44 — deci textul ar fi rămas alb pe chihlimbar, la 2,15:1, exact cazul
 * de care funcția trebuia să apere.
 */
const DARK_INK_THRESHOLD = 0.224

/** Luminanța relativă WCAG a unei culori `#rrggbb`. */
export function relativeLuminance(hex: string): number {
  const value = hex.replace('#', '')
  const channel = (pair: string) => {
    const c = parseInt(pair, 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return (
    0.2126 * channel(value.slice(0, 2)) +
    0.7152 * channel(value.slice(2, 4)) +
    0.0722 * channel(value.slice(4, 6))
  )
}

/**
 * Alb sau cerneală închisă, după cât de deschisă e culoarea de fond. Paleta de
 * avatare merge de la indigo la chihlimbar, iar albul pe chihlimbar n-ar fi
 * lizibil.
 */
export function readableInk(hex: string): string {
  return relativeLuminance(hex) > DARK_INK_THRESHOLD ? DARK_INK : LIGHT_INK
}
