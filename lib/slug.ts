/**
 * Slug-ul unui nume, în forma folosită de rutele de faze: fără diacritice, fără
 * majuscule, cu cratime în loc de orice altceva.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
