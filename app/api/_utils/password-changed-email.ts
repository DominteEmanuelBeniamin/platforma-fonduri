import { Resend } from 'resend'
import { escapeHtml, resendFromAddress, resolveReminderDelivery, sanitizeHeaderText } from './email'

/**
 * Anunță titularul contului că parola s-a schimbat din „Contul meu”. Dacă nu
 * a fost el, află imediat. Erorile nu schimbă rezultatul: parola e deja salvată.
 */
export async function sendPasswordChangedEmail(input: { email: string; fullName: string | null; changedAt: Date }) {
  try {
    const delivery = resolveReminderDelivery(input.email)
    if (!delivery.ok) return
    const when = input.changedAt.toLocaleString('ro-RO', {
      timeZone: 'Europe/Bucharest', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })
    const name = input.fullName?.trim()
    const greeting = name ? 'Bună, ' + name + ',' : 'Bună,'
    const changed = 'Parola contului tău Bonie a fost schimbată pe ' + when + ', din pagina „Contul meu”. Celelalte dispozitive pe care erai conectat au fost deconectate.'
    const warning = 'Dacă nu ai schimbat-o tu, scrie-i imediat administratorului platformei, ca să-ți reseteze parola.'
    const account = 'Acest mesaj privește contul ' + delivery.data.intendedEmail + '.'
    const resend = new Resend(process.env.RESEND_API_KEY)
    const { error } = await resend.emails.send({
      from: resendFromAddress(),
      to: delivery.data.deliveryEmail,
      subject: sanitizeHeaderText('Parola contului tău a fost schimbată'),
      html: '<p>' + escapeHtml(greeting) + '</p>'
        + '<p>' + escapeHtml(changed) + '</p>'
        + '<p><strong>' + escapeHtml(warning) + '</strong></p>'
        + '<p style="color:#6b7280;font-size:12px">' + escapeHtml(account) + '</p>',
      text: greeting + '\n\n' + changed + '\n\n' + warning + '\n\n' + account,
    })
    if (error) console.error('Password changed email rejected:', error)
  } catch (error) {
    console.error('Password changed email failed (non-blocking):', error)
  }
}
