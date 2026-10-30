import { escapeHtml } from '@/app/api/_utils/email'

export type TemporaryPasswordEmailContext = 'welcome' | 'admin_reset'

export type TemporaryPasswordEmailInput = {
  context: TemporaryPasswordEmailContext
  fullName: string
  email: string
  password: string
  loginUrl: string
  companyName?: string | null
}

export function renderTemporaryPasswordEmail(input: TemporaryPasswordEmailInput) {
  const introduction = input.context === 'welcome'
    ? 'Ai acum acces la Bonie' + (input.companyName ? ' pentru ' + input.companyName : '') +
      '. Folosește datele de mai jos pentru a te autentifica:'
    : 'Un administrator a resetat parola contului tău în Bonie. Folosește parola temporară de mai jos pentru a te autentifica.'
  // „Contul meu” se deschide din adresa de email din dreapta sus, pe orice pagină.
  const changePassword = input.context === 'welcome'
    ? 'După autentificare, alege-ți o parolă a ta: apasă pe adresa ta de email din dreapta sus („Contul meu”), apoi „Schimbă parola”.'
    : 'După autentificare, alege-ți o parolă nouă pentru a-ți proteja contul: apasă pe adresa ta de email din dreapta sus („Contul meu”), apoi „Schimbă parola”.'
  const safeEmail = escapeHtml(input.email)
  const safePassword = escapeHtml(input.password)
  const safeLoginUrl = escapeHtml(input.loginUrl)
  // Profilurile fără nume primesc un salut simplu, nu „Bună, ,”.
  const fullName = input.fullName.trim()
  const greeting = fullName ? 'Bună, ' + fullName + ',' : 'Bună,'

  return {
    subject: input.context === 'welcome'
      ? 'Bun venit în Bonie'
      : 'Parolă temporară resetată de administrator',
    html: '<p>' + escapeHtml(greeting) + '</p>' +
      '<p>' + escapeHtml(introduction) + '</p>' +
      '<p>Adresa de email: <strong>' + safeEmail + '</strong></p>' +
      '<p>Parola temporară: <code>' + safePassword + '</code></p>' +
      '<p>Intră în cont: <a href="' + safeLoginUrl + '">' + safeLoginUrl + '</a></p>' +
      '<p>' + escapeHtml(changePassword) + '</p>',
    text: greeting + '\n\n' + introduction + '\n\n' +
      'Adresa de email: ' + input.email + '\n' +
      'Parola temporară: ' + input.password + '\n' +
      'Intră în cont: ' + input.loginUrl + '\n\n' +
      changePassword,
  }
}
