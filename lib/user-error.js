export function userErrorMessage(status, fallback) {
  if (!status) return `${fallback} Verifică conexiunea și reîncearcă.`

  const messages = {
    400: 'Datele trimise nu sunt valide. Verifică informațiile și reîncearcă.',
    401: 'Sesiunea a expirat. Autentifică-te din nou.',
    403: 'Nu ai permisiunea necesară pentru această acțiune.',
    404: 'Elementul solicitat nu mai este disponibil.',
    409: 'Acțiunea nu poate fi finalizată din cauza unei modificări existente.',
    413: 'Fișierul este prea mare. Alege un fișier mai mic.',
    422: 'Verifică datele introduse și reîncearcă.',
    429: 'Sunt prea multe solicitări. Reîncearcă peste câteva momente.',
  }

  return messages[status] || (status >= 500 ? `${fallback} Reîncearcă peste câteva momente.` : fallback)
}

export async function responseErrorMessage(response, fallback) {
  return userErrorMessage(response.status, fallback)
}
