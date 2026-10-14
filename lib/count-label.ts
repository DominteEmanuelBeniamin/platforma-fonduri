/**
 * Numeralul românesc cere „de" peste 20, dar nu la 101–119: „3 termene", „21 de
 * termene", „118 termene". Fără regula asta, linia de rezumat ar fi scris „21
 * termene" de fiecare dată când platforma crește.
 *
 * Stă în fișierul lui ca să-l poată folosi și calendarul, și textele de
 * încheiere și finalizare (#109) fără ca unul să-l importe pe celălalt.
 */
export function countLabel(count: number, singular: string, plural: string): string {
  if (count === 1) return `1 ${singular}`
  const lastTwo = Math.abs(count) % 100
  const needsDe = Math.abs(count) >= 20 && !(lastTwo >= 1 && lastTwo <= 19)
  return `${count} ${needsDe ? 'de ' : ''}${plural}`
}
