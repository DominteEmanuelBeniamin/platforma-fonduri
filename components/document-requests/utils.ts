/**
 * Numele unui fișier, adus la o formă comparabilă: fără diacritice, fără
 * spații duble, în litere mici. Folosit ca să avertizăm când cineva urcă de
 * două ori același document sub nume aproape identice.
 */
export function normalizeFileName(filename: string | null | undefined): string {
  return (filename || '').trim().toLowerCase()
}
